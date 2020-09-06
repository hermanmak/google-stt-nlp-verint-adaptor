// Imports the Google Cloud client library
const speech = require("@google-cloud/speech").v1p1beta1;
const language = require("@google-cloud/language");
const fs = require("fs");
const { Console, debug } = require("console");
const yargs = require("yargs");

const argv = yargs
  .scriptName("verintnlpsst")
  .usage("node index.js -p str -k str -g str -l str -s num -e str -d bool")
  .example(
    "node index.js -p nlp-stt -k /Users/hermanmak/Documents/Dev/nlp-stt-16634c694dd7.json -g gs://raw-voice-clip/20200817-173613.flac -l yue-Hant-HK -s 48000 -e FLAC -d true"
  )
  .option("p", {
    alias: "projectId",
    description:
      "The Google Cloud ProjectID which to call the Cloud AI APIs for",
    type: "string",
    demandOption: true,
    nargs: 1,
  })
  .option("k", {
    alias: "keyFileName",
    description: "The service account key to call Cloud AI APIs with",
    type: "string",
    demandOption: true,
    nargs: 1,
  })
  .option("g", {
    alias: "sttGcsUri",
    description: "The gcsUri of the voice clip",
    type: "string",
    demandOption: true,
    nargs: 1,
  })
  .option("e", {
    alias: "sttEncoding",
    description: "The encoding type for the voice clip",
    type: "string",
    demandOption: true,
    nargs: 1,
  })
  .option("s", {
    alias: "sttSampleHertzRate",
    description: "The Sampling rate in Hertz of the voice clip",
    type: "number",
    demandOption: true,
    nargs: 1,
  })
  .option("l", {
    alias: "sttLanguageCode",
    description: "The language code for the voice clip",
    type: "string",
    demandOption: true,
    nargs: 1,
  })
  .option("d", {
    alias: "debugMode",
    description: "Toggle debugMode for console log outputs",
    type: "boolean",
    default: false,
    nargs: 1,
  })
  .describe("help", "Show help")
  .epilog("Copyright 2020")
  .parse();
const isDebugMode = argv.debugMode;

async function main() {
  const projectId = argv.projectId;
  const keyFileName = argv.keyFileName;

  // Creates client(s)
  const speechClient = new speech.SpeechClient({
    projectId,
    keyFilename: keyFileName,
  });
  const languageClient = new language.LanguageServiceClient({
    projectId,
    keyFilename: keyFileName,
  });

  // 1) Trigger STT
  const gcsUri = argv.sttGcsUri;
  const encoding = argv.sttEncoding;
  const sampleRateHertz = argv.sttSampleRateHertz;
  const languageCode = argv.sttLanguageCode;

  const config = {
    enableWordTimeOffsets: true,
    enableSpeakerDiarization: true,
    enableAutomaticPunctuation: true,
    enableWordConfidence: true,
    encoding: encoding,
    sampleRateHertz: sampleRateHertz,
    languageCode: languageCode,
  };

  const audio = {
    uri: gcsUri,
  };

  const speechRequest = {
    config: config,
    audio: audio,
  };

  const [operation] = await speechClient.longRunningRecognize(speechRequest);

  // 2) Process Speech response
  const [speechResponse] = await operation.promise();

  debugLogger(
    `JSON response from Cloud STT: ${JSON.stringify(speechResponse, null, 4)}`
  );
  var sttTranscript = speechResponse.results[0].alternatives[0].transcript;
  var sttWordInfoArray = speechResponse.results[0].alternatives[0].words;

  // 3) Trigger NLP
  const document = {
    content: sttTranscript,
    type: "PLAIN_TEXT",
  };

  const languageRequest = { document: document, encodingType: "NONE" };
  const [languageResponse] = await languageClient.analyzeEntities(
    languageRequest
  );
  debugLogger(
    `JSON response from Cloud NLP: ${JSON.stringify(languageResponse, null, 4)}`
  );

  /**
   * 5) Create needed working data formats
   */
  const output = getVerintOutputFromSTTWordInfoArray(sttWordInfoArray); // Unmerged output
  const sttWordOnlyArray = extractWordOnlyArray(sttWordInfoArray); // Just STT words in an array
  var normalizedTranscript = createNormalizedTranscript(
    sttWordInfoArray,
    sttTranscript
  ); // A transcript with multicharacter words set to 1 character

  /**
   * 6) Merge step
   * 6.1) Handle all single English entities first, single word English entities appear in Cloud STT as a single term. Ignore those.
   * 6.2) Handle multi Engine entities, they contain spaces in the Cloud NLP output.
   * 6.3) Handle chinese entities last.
   */

  // 6.3
  languageResponse.entities.forEach((entity) => {
    if (
      entity.name.length > 1 &&
      sttWordOnlyArray.includes(entity.name) == false &&
      normalizedTranscript.indexOf(entity.name) != -1 //compound chinese english entities slip through
    ) {
      var chineseEntityFirstWordIndex = normalizedTranscript.indexOf(
        entity.name
      );
      debugLogger("first index " + chineseEntityFirstWordIndex);
      var averageConfidence = getAverageConfidenceForWordArray(
        chineseEntityFirstWordIndex,
        sttWordInfoArray,
        sttWordOnlyArray,
        entity.name.length
      );
      var startTime = getStartTimeFromCloudSTTWordInfo(
        sttWordInfoArray[chineseEntityFirstWordIndex]
      );
      var endIndex = chineseEntityFirstWordIndex + entity.name.length - 1;
      var endTime = getEndTimeFromCloudSTTWordInfo(
        sttWordInfoArray[chineseEntityFirstWordIndex + entity.name.length - 1]
      );
      var duration = (endTime - startTime).toFixed(1);
      var speaker = 0;

      debugLogger(
        `${
          entity.name
        } starting at index ${chineseEntityFirstWordIndex} inside ${JSON.stringify(
          sttWordInfoArray[chineseEntityFirstWordIndex]
        )} with start time ${startTime} end found at index ${endIndex} with end time ${endTime} inside ${JSON.stringify(
          sttWordInfoArray[chineseEntityFirstWordIndex + entity.name.length - 1]
        )}, so duration ${
          endTime - startTime
        } and average confidence ${averageConfidence}`
      );

      // Construct the multi word Chinese Entity
      var combinedEntity = {
        start: startTime,
        duration: duration,
        speaker: speaker,
        best: {
          word: entity.name,
          score: getVerintScoreFromConfidence(averageConfidence),
        },
        alternatives: [],
      };
      Array.prototype.splice.apply(
        output["terms"],
        [chineseEntityFirstWordIndex, entity.name.length].concat(combinedEntity)
      );
    }
  });

  debugLogger(`Merged output is ${JSON.stringify(output, null, 4)}`);
}

/**
 * A Console log wrapper that takes into account debug enabling.
 * @param {*} stringToPrint
 */
function debugLogger(stringToPrint) {
  if (isDebugMode) {
    console.log(stringToPrint);
  }
}

/**
 * Extract a start time from Cloud STT wordInfo object.
 * @param {*} wordInfo the object.
 */
function getStartTimeFromCloudSTTWordInfo(wordInfo) {
  const temp =
    `${wordInfo.startTime.seconds}` +
    "." +
    wordInfo.startTime.nanos / 100000000;
  return temp;
}

/**
 * Extract a end time from Cloud STT wordInfo object.
 * @param {} wordInfo
 */
function getEndTimeFromCloudSTTWordInfo(wordInfo) {
  return (
    `${wordInfo.endTime.seconds}` + "." + wordInfo.endTime.nanos / 100000000
  );
}

/**
 * Calculate an average confidence based on the confidence scores of the individual words.
 * @param {*} wordArray
 * @param {*} sttWordInfoArray
 * @param {*} sttWordOnlyArray
 */
function getAverageConfidenceForWordArray(
  firstIndex,
  sttWordInfoArray,
  sttWordOnlyArray,
  length
) {
  var averageConfidence = 0;
  var index = 0;
  while (index < length) {
    averageConfidence +=
      sttWordInfoArray[firstIndex + index].confidence / length;

    index++;
  }
  return averageConfidence;
}

/**
 * Convert Cloud Speech To Text Response to Verint Output format
 * @param {*} sttWordInfoArray 
 */
function getVerintOutputFromSTTWordInfoArray(sttWordInfoArray) {
  const output = {};
  var key = "terms"; // This output payload
  output[key] = []; // An empty array JSON

  sttWordInfoArray.forEach((wordInfo) => {
    var start = getStartTimeFromCloudSTTWordInfo(wordInfo);
    var end = getEndTimeFromCloudSTTWordInfo(wordInfo);

    var duration = (end - start).toFixed(1);
    var speaker = wordInfo.speakerTag;
    var best = {
      word: wordInfo.word,
      score: getVerintScoreFromConfidence(wordInfo.confidence),
    };
    var alternatives = [];

    output[key].push({
      start,
      duration,
      speaker,
      best,
      alternatives,
    });
  });

  return output;
}

/**
 * Normalizing Transcript by remove English words from transcript. It causes issue with finding index placements.
 * @param {*} wordInfoArray
 * @param {*} transcript
 */
function createNormalizedTranscript(wordInfoArray, transcript) {
  var temp = transcript; //Create a copy to edit
  wordInfoArray.forEach((wordInfo) => {
    if (wordInfo.word.length > 1) {
      //This word is likely English. To get an accurate index of where to combine chinese words we need to shrink multi character english words to 1 character. Lets use ~.
      temp = temp.replace(wordInfo.word, "~");
    }
  });

  debugLogger(`Normalized Transcript is ${temp}`);
  return temp; //Return the editted copy.
}

/**
 * Extract all words from Cloud Speech To Text Response into an ordered array.
 * @param {*} sttWordInfoArray
 */
function extractWordOnlyArray(sttWordInfoArray) {
  const wordOnlyArray = [];
  sttWordInfoArray.forEach((wordInfo) => {
    wordOnlyArray.push(wordInfo.word);
  });

  return wordOnlyArray;
}

/**
 * Convert Google Cloud AI confidence scores to Verint based confidence score
 * @param {*} confidence Google Cloud AI confidence scoring float
 */
function getVerintScoreFromConfidence(confidence) {
  return confidence * 1000;
}

main().catch(console.error);
