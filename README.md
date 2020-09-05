# Google Cloud AI Verint Adaptor
This adaptor is not official and is provided for anyone to use. No SLA is provided.

# Setup
1. Generate a service account from the Google Cloud Console, it should provide you with a JSON key file.
2. Place the JSON key file in any directory and note down the path.
3. In the command line run `npm install` to install all dependencies listed in package.json
4. Run `node index.js -p str -k str -g str -l str -s num -e str -d bool`, substitute your values as necessary. 
    > * Run node `index.html --help` for an example and more information of parameters!
    > * Supported `sttEncoding` can be found here https://cloud.google.com/speech-to-text/docs/encoding#audio-encodings
    > * Supported `sttLanguage` can be found here https://cloud.google.com/speech-to-text/docs/languages