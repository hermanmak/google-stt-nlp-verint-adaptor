from google.cloud import speech_v1p1beta1
from google.cloud.speech_v1p1beta1 import enums

def get_merged(storage_uri):
    """
    1) Perform STT API call on input_file
    2) Perform NLP API call on input_file
    3) Find and merge NLP output into STT output

    Args:
      storage_uri URI for audio file in Cloud Storage, e.g. gs://[BUCKET]/[FILE]
    """

    client = speech_v1p1beta1.SpeechClient()

    # storage_uri = 'gs://cloud-samples-data/speech/brooklyn_bridge.mp3'

    # The language of the supplied audio
    language_code = "yue-Hant-HK"

    # Sample rate in Hertz of the audio data sent
    sample_rate_hertz = 44100

    # Encoding of audio data sent. This sample sets this explicitly.
    # This field is optional for FLAC and WAV audio formats.
    encoding = enums.RecognitionConfig.AudioEncoding.MP3
    config = {
        "language_code": language_code,
        "sample_rate_hertz": sample_rate_hertz,
        "encoding": encoding,
    }
    audio = {"uri": storage_uri}

    response = client.analyze_text()
    for result in response.results:
        # First alternative is the most probable result
        alternative = result.alternatives[0]
        print(u"Transcript: {}".format(alternative.transcript))

    

# [END speech_quickstart_beta]


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--storage_uri",
        type=str,
        default="gs://cloud-samples-data/speech/brooklyn_bridge.mp3",
    )
    args = parser.parse_args()

    get_merged(args.storage_uri)


if __name__ == "__main__":
    main()