// Imports the Google Cloud client library
const speech = require("@google-cloud/speech").v1p1beta1;
const language = require("@google-cloud/language");
const fs = require("fs");
const { Console } = require("console");
const yargs = require("yargs");

const argv = yargs
  .scriptName("verintnlpsst")
  .usage("node index.js -p str -k str -g str -l str -s num -e str -d bool")
  .example("node index.js -p nlp-stt -k /Users/hermanmak/Documents/Dev/nlp-stt-16634c694dd7.json -g gs://raw-voice-clip/20200817-173613.flac -l yue-Hant-HK -s 48000 -e FLAC -d true")
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
    nargs: 1
  })
  .describe("help", "Show help")
  .epilog("Copyright 2020")
  .parse();

// Set to true for all logging output
const isDebugMode = argv.debugMode;

async function main() {
  const projectId = argv.projectId; // nlp-stt
  const keyFileName = argv.keyFileName; // /Users/hermanmak/Documents/Dev/nlp-stt-16634c694dd7.json

  // Creates client(s)
  const speechClient = new speech.SpeechClient({ projectId, keyFilename: keyFileName });
  const languageClient = new language.LanguageServiceClient({
    projectId,
    keyFilename: keyFileName,
  });

  // 1) Trigger STT
  const gcsUri = argv.sttGcsUri; //"gs://raw-voice-clip/20200817-173613.flac"
  const encoding = argv.sttEncoding; //"FLAC"
  const sampleRateHertz = argv.sttSampleRateHertz; //48000
  const languageCode = argv.sttLanguageCode; //"yue-Hant-HK"

  const config = {
    enableWordTimeOffsets: true,
    enableSpeakerDiarization: true,
    audioChannelCount: true,
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

  // 5) Construct unmerged Verint payload
  const output = {};
  var key = "terms"; // This output payload
  output[key] = []; // An empty array JSON

  const sttWordOnlyArray = [];

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
    sttWordOnlyArray.push(wordInfo.word);
  });
  debugLogger(`Non merged output is ${JSON.stringify(output, null, 4)}`);

  /**
   * 6) Merge step
   * 6.1) Handle all single English entities first, single word English entities appear in Cloud STT as a single term. Ignore those.
   * 6.2) Handle multi Engine entities, they contain spaces in the Cloud NLP output.
   * 6.3) Handle chinese entities last.
   */
  // 6.2
  languageResponse.entities.forEach((entity) => {
    if (entity.name.includes(" ")) {
      var temp = entity.name.split(" ");
      var firstIndex = sttWordOnlyArray.indexOf(temp[0]);

      // Construct the multi word English Entity
      var combineEntity = {
        startTime: getStartTimeFromCloudSTTWordInfo(
          sttWordInfoArray[firstIndex]
        ),
        endTime: getEndTimeFromCloudSTTWordInfo(
          sttWordInfoArray[firstIndex + temp.length]
        ),
        word: entity.name,
        confidence: 100,
      };
      Array.prototype.splice.apply(
        output["terms"],
        [firstIndex, temp.length].concat(combineEntity)
      );
    }
  });

  // 6.3
  languageResponse.entities.forEach((entity) => {
    if (
      entity.name.length > 1 &&
      sttWordOnlyArray.includes(entity.name) == false
    ) {
      var chineseEntityWordArray = entity.name.split("");
      var chineseEntityFirstWordIndex = sttWordOnlyArray.indexOf(
        chineseEntityWordArray[0]
      );
      var averageConfidence = getAverageConfidenceForWordArray(
        chineseEntityWordArray,
        sttWordInfoArray,
        sttWordOnlyArray
      );

      debugLogger(
        "Found " +
          chineseEntityWordArray[0] +
          " at index " +
          chineseEntityFirstWordIndex +
          "should be inside " +
          JSON.stringify(
            sttWordInfoArray[chineseEntityFirstWordIndex],
            null,
            4
          ) +
          " starttime is " +
          getStartTimeFromCloudSTTWordInfo(
            sttWordInfoArray[chineseEntityFirstWordIndex]
          ) +
          " endtime at index " +
          (chineseEntityFirstWordIndex + chineseEntityWordArray.length) +
          "should be inside " +
          JSON.stringify(
            sttWordInfoArray[
              chineseEntityFirstWordIndex + chineseEntityWordArray.length - 1
            ],
            null,
            4
          ) +
          " is " +
          getEndTimeFromCloudSTTWordInfo(
            sttWordInfoArray[
              chineseEntityFirstWordIndex + chineseEntityWordArray.length - 1
            ]
          ) +
          " average confidence of " +
          averageConfidence
      );

      // Construct the multi word Chinese Entity
      var startTime = getStartTimeFromCloudSTTWordInfo(
        sttWordInfoArray[chineseEntityFirstWordIndex - 1]
      );
      var endTime = getEndTimeFromCloudSTTWordInfo(
        sttWordInfoArray[
          chineseEntityFirstWordIndex + chineseEntityWordArray.length - 1
        ]
      );
      var duration = (endTime - startTime).toFixed(1);
      var speaker = 0;

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
        [chineseEntityFirstWordIndex, chineseEntityWordArray.length].concat(
          combinedEntity
        )
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
  wordArray,
  sttWordInfoArray,
  sttWordOnlyArray
) {
  var averageConfidence = 0;
  wordArray.forEach((word) => {
    debugLogger(
      "The word " + word + " indexed at " + sttWordOnlyArray.indexOf(word)
    );

    averageConfidence +=
      sttWordInfoArray[sttWordOnlyArray.indexOf(word)].confidence /
      wordArray.length;
  });
  return averageConfidence;
}

/**
 * Convert Google Cloud AI confidence scores to Verint based confidence score
 * @param {*} confidence Google Cloud AI confidence scoring float
 */
function getVerintScoreFromConfidence(confidence) {
  return confidence * 1000;
}

main().catch(console.error);
