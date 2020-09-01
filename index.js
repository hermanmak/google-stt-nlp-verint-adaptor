// Imports the Google Cloud client library
const speech = require("@google-cloud/speech").v1p1beta1;
const language = require("@google-cloud/language");
const fs = require("fs");

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
  speechResponse.results.forEach((result) => {
    console.log(`Transcription: ${result.alternatives[0].transcript}`);

    result.alternatives[0].words.forEach((wordInfo) => {
      // NOTE: If you have a time offset exceeding 2^32 seconds, use the
      // wordInfo.{x}Time.seconds.high to calculate seconds.
      const startSecs =
        `${wordInfo.startTime.seconds}` +
        "." +
        wordInfo.startTime.nanos / 100000000;
      const endSecs =
        `${wordInfo.endTime.seconds}` +
        "." +
        wordInfo.endTime.nanos / 100000000;
      console.log(`Word: ${wordInfo.word}`);
      console.log(`\t ${startSecs} secs - ${endSecs} secs`);
      console.log(`Confidence: ` + wordInfo.confidence);
      console.log(`Raw form ${wordInfo}`);
    });
  });

  console.log("Speech Response: " + JSON.stringify(speechResponse, null, 4));
  var speechRawPayload = speechResponse.results[0].alternatives[0].transcript;
  var speechWordArray = speechResponse.results[0].alternatives[0].words;
  console.log(`Word Array: ${JSON.stringify(speechWordArray, null, 4)}`);

  // 3) Trigger NLP
  const document = {
    content: speechRawPayload,
    type: "PLAIN_TEXT",
  };

  const languageRequest = { document: document, encodingType: "NONE" };
  const [languageResponse] = await languageClient.analyzeEntities(
    languageRequest
  );

  console.log(languageResponse);

  // 5) Construct output and mergetemp payload
  const output = {};
  var key = "terms"; // This output payload
  output[key] = []; // An empty array JSON

  const mergeTemp = [];

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
    mergeTemp.push(wordInfo.word);
  });
  console.log(`Non merged output is ${JSON.stringify(output, null, 4)}`);
  console.log( `MergeTemp is ${JSON.stringify(mergeTemp, null, 4)}`);

  // 6) Merge and replace
  languageResponse.entities.forEach((entity) => {
    console.log(speechRawPayload);
    var entityName = entity.name;
    console.log("entity name " + entityName);

    var startingIndex = speechWordArray.indexOf(entityName).valueOf();
    console.log("hhherman " + startingIndex);

    // Exact matches like English words actually show up as a single word in STT API so we will // so a exact match at the detected index, if it happens then we will replace length with 1
    console.log("herman " + speechWordArray[startingIndex]);

    var wordLength = speechWordArray[startingIndex].word == entityName ? 1 : entityName.length;

    console.log(
      `${entityName} present in text? ${speechRawPayload.includes(
        entityName
      )} beginning at ${speechRawPayload.indexOf(
        entityName
      )} with itself being length ${wordLength}`
    );
  });
  console.log(`Merged output is ${JSON.stringify(output, null, 4)}`);
}
main().catch(console.error);
