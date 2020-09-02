# Google Cloud AI Verint Adaptor
This adaptor is not official and is provided for anyone to use. No SLA is provided.

# Setup
1) Generate a service account from the Google Cloud Console, it should provide you with a JSON key file.
2) Place the JSON key file in any directory and replace the `PROJECTID` and `YOURKEYLOCATION` with your values.
3) Input audio clip supported is FLAC.
4) Provide a Google Cloud Storage Bucket location `gs://YOURFILELOCATION` or a local path.
5) In the command line run `npm install` to install all dependencies listed in package.json
6) Run `node index.js`

# Optional
1) Enable debugging mode for Console output logging by setting isDebugMode=true.