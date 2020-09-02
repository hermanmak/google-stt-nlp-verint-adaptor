// Imports the Google Cloud client library
const speech = require("@google-cloud/speech").v1p1beta1;
const language = require("@google-cloud/language");
const fs = require("fs");
const { Console } = require("console");

const isDebugMode = true;

async function main() {
  const projectId = "nlp-stt";
  const keyFilename =
    "/Users/hermanmak/Documents/Dev/nlp-stt-16634c694dd7.json";
  // Creates client(s)
  const speechClient = new speech.SpeechClient({ projectId, keyFilename });
  const languageClient = new language.LanguageServiceClient({
    projectId,
    keyFilename,
  });

  // // 1) Trigger STT
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

  debugLogger(`JSON response from Cloud STT: ${JSON.stringify(speechResponse, null, 4)}`);
  var speechRawPayload = speechResponse.results[0].alternatives[0].transcript;
  var speechWordArray = speechResponse.results[0].alternatives[0].words;

  // 3) Trigger NLP
  const document = {
    content: speechRawPayload,
    type: "PLAIN_TEXT",
  };

  const languageRequest = { document: document, encodingType: "NONE" };
  const [languageResponse] = await languageClient.analyzeEntities(
    languageRequest
  );

  debugLogger(`JSON response from Cloud NLP: ${JSON.stringify(languageResponse,null,4)}`);

  // 5) Construct output and mergetemp payload
  const output = {};
  var key = "terms"; // This output payload
  output[key] = []; // An empty array JSON

  const wordOnlyArray = [];

  speechWordArray.forEach((wordInfo) => {
    var start =
      `${wordInfo.startTime.seconds}` +
      "." +
      wordInfo.startTime.nanos / 100000000;
    var end =
      `${wordInfo.endTime.seconds}` + "." + wordInfo.endTime.nanos / 100000000;

    var duration = end - start;
    var speaker = wordInfo.speakerTag;
    var best = {
      word: wordInfo.word,
      score: wordInfo.confidence * 1000,
    };
    var alternatives = [];

    output[key].push({
      start,
      duration,
      speaker,
      best,
      alternatives,
    });
    wordOnlyArray.push(wordInfo.word);
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
      var firstIndex = wordOnlyArray.indexOf(temp[0]);

      // Construct the multi word English Entity
      var combineEntity = {
        startTime: getStartTimeFromCloudSTTWordInfo(
          speechWordArray[firstIndex]
        ),
        endTime: getEndTimeFromCloudSTTWordInfo(
          speechWordArray[firstIndex + temp.length]
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
      wordOnlyArray.includes(entity.name) == false
    ) {
      var temp = entity.name.split("");
      var firstIndex = wordOnlyArray.indexOf(temp[0]);

      debugLogger(
        "Found " +
          temp[0] +
          " at index " +
          firstIndex +
          "should be inside " +
          JSON.stringify(speechWordArray[firstIndex], null, 4) +
          " starttime is " +
          getStartTimeFromCloudSTTWordInfo(speechWordArray[firstIndex]) +
          " endtime at index " +
          (firstIndex + temp.length) +
          "should be inside " +
          JSON.stringify(
            speechWordArray[firstIndex + temp.length - 1],
            null,
            4
          ) +
          " is " +
          getEndTimeFromCloudSTTWordInfo(
            speechWordArray[firstIndex + temp.length - 1]
          )
      );

      // Construct the multi word Chinese Entity
      var combinedEntity = {
        startTime: getStartTimeFromCloudSTTWordInfo(
          speechWordArray[firstIndex - 1]
        ),
        endTime: getEndTimeFromCloudSTTWordInfo(
          speechWordArray[firstIndex + temp.length - 1]
        ),
        word: entity.name,
        confidence: 100,
      };
      Array.prototype.splice.apply(
        output["terms"],
        [firstIndex, temp.length].concat(combinedEntity)
      );
    }
  });

  debugLogger(`Merged output is ${JSON.stringify(output, null, 4)}`);
}

// This function only prints to console if debug mode is enabled
function debugLogger(stringToPrint) {
  if (isDebugMode) {
    console.log(stringToPrint);
  }
}

// Checks if a entity is an English entity based on presence of a space or an exact match
function isEnglishEntity(entity, wordOnlyArray) {
  if (entity.name.includes(" ")) {
    return true;
  } else if (entity.length > 1 && wordOnlyArray.includes([entity])) {
    return true;
  } else {
    return false;
  }
}

function getStartTimeFromCloudSTTWordInfo(wordInfo) {
  const temp =
    `${wordInfo.startTime.seconds}` +
    "." +
    wordInfo.startTime.nanos / 100000000;
  return temp;
}

function getEndTimeFromCloudSTTWordInfo(wordInfo) {
  return (
    `${wordInfo.endTime.seconds}` + "." + wordInfo.endTime.nanos / 100000000
  );
}

main().catch(console.error);
