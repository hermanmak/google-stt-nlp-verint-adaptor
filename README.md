# Google Cloud AI Verint Adaptor
This adaptor is not official and is provided for anyone to use. No SLA is provided.

# Setup
1) Generate a service account from the Google Cloud Console, it should provide you with a JSON key file.
2) Place the JSON key file in any directory and replace the `PROJECTID` and `YOURKEYLOCATION` with your values.
3) In the command line run `npm install` to install all dependencies listed in package.json
4) Run `node index.js YOURFILELOCATION AUDIOCODEC SAMPLINGRATE LANUGAGE`. A sample would be `node index.js gs://raw-voice-clip/20200817-173613.flac FLAC 48000 yue-Hant-HK`.

# Optional
1) Enable debugging mode for Console output logging by setting `isDebugMode=true`.