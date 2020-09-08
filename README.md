# Google Cloud AI Verint Adaptor
This adaptor is not official and is provided for anyone to use. No SLA is provided.

# Setup
1. [Enable](https://console.cloud.google.com/flows/enableapi?apiid=language.googleapis.com) the Cloud Natural Language API
2. [Enable](https://console.cloud.google.com/flows/enableapi?apiid=speech.googleapis.com) the Cloud Speech To Text API
3. Generate a service account from the Google Cloud Console, it should provide you with a JSON key file.
4. Place the JSON key file in any directory and note down the path.
5. Run `gcloud auth activate-service-account ACCOUNT --key-file=KEYFILELOCATION` making sure to substitute the correct `ACCOUNT` and `KEYFILELOCATION`
5. In the same directory as `package.json` run `npm install` to install all dependencies required
6. Run `node index.js -p str -k str -g str -l str -s num -e str -d bool`, substitute your values as necessary. 
    > * Run node `index.html --help` for an example and more information of parameters!
    > * Supported `sttEncoding` can be found [here](https://cloud.google.com/speech-to-text/docs/encoding#audio-encodings)
    > * Supported `sttLanguage` can be found [here](https://cloud.google.com/speech-to-text/docs/languages)

# Limitations
* Multi Language Entities from NLP cannot be merged due to edge case.
    > Example. `同埋discount`