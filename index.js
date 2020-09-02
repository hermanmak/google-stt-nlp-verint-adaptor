// Imports the Google Cloud client library
const speech = require("@google-cloud/speech").v1p1beta1;
const language = require("@google-cloud/language");
const fs = require("fs");
const { Console } = require("console");

// Set to true for all logging output
const isDebugMode = false;

async function main() {
  const projectId = "YOURPROJECTNAME";
  const keyFilename = "YOURKEYLOCATION";
  
    // Creates client(s)
  const speechClient = new speech.SpeechClient({ projectId, keyFilename });
  const languageClient = new language.LanguageServiceClient({
    projectId,
    keyFilename,
  });

  // 1) Trigger STT
  const gcsUri = "gs://raw-voice-clip/20200817-173613.flac";
  const encoding = "FLAC";
  const sampleRateHertz = 48000;
  const languageCode = "yue-Hant-HK";

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

    var duration = end - start;
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
      var duration = endTime - startTime;
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
