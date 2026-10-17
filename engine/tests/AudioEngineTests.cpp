#include "AudioEngine.h"

#include <cmath>
#include <memory>
#include <iostream>

int main()
{
    skvdj::AudioEngine engine;
    const auto expect = [](bool condition, const char* message)
    {
        if (!condition)
        {
            std::cerr << message << '\n';
            return false;
        }
        return true;
    };
    if (!expect(engine.setDeckGain(0, 0.5f).wasOk(), "Valid gain was rejected.")
        || !expect(engine.setDeckGain(4, 0.5f).failed(), "Out-of-range deck was accepted.")
        || !expect(engine.setDeckGain(0, 1.6f).failed(), "Out-of-range gain was accepted.")
        || !expect(engine.setDeckEq(0, -12.0f, 3.0f, 6.0f).wasOk(), "Valid EQ values were rejected.")
        || !expect(engine.setDeckEq(0, -25.0f, 0.0f, 0.0f).failed(), "Out-of-range EQ was accepted.")
        || !expect(engine.setDeckCue(0, true).failed(), "Headphone cue was accepted without four outputs.")
        || !expect(engine.seek(0, -1.0).failed(), "Negative seek was accepted.")
        || !expect(engine.play(0).failed(), "An empty deck started playing.")
        || !expect(engine.pause(0).wasOk(), "Pausing an empty deck failed.")
        || !expect(engine.stop(3).wasOk(), "Stopping a valid empty deck failed."))
        return 1;

    const auto file = juce::File::getSpecialLocation(juce::File::tempDirectory)
        .getChildFile("sir-kevin-waveform-test.wav");
    juce::WavAudioFormat wavFormat;
    auto* stream = new juce::FileOutputStream(file);
    std::unique_ptr<juce::AudioFormatWriter> writer(
        wavFormat.createWriterFor(stream, 48000.0, 2, 16, {}, 0));
    if (!expect(writer != nullptr, "Could not create waveform test audio."))
        return 1;
    juce::AudioBuffer<float> source(2, 4800);
    for (int sample = 0; sample < source.getNumSamples(); ++sample)
    {
        const auto value = 0.5f * std::sin(juce::MathConstants<float>::twoPi * 440.0f * sample / 48000.0f);
        source.setSample(0, sample, value);
        source.setSample(1, sample, value);
    }
    if (!expect(writer->writeFromAudioSampleBuffer(source, 0, source.getNumSamples()),
                "Could not write waveform test audio."))
        return 1;
    writer.reset();
    if (!expect(engine.loadTrack(0, file).wasOk(), "A valid WAV failed to load.")
        || !expect(engine.deckSnapshot(0).waveformPeaks.empty(),
                   "Routine deck snapshots should not copy waveform data.")
        || !expect(engine.deckSnapshot(0, true).waveformPeaks.size() == 512,
                   "Track analysis did not produce the expected waveform peaks.")
        || !expect(engine.deckSnapshot(0, true).waveformPeaks[100] > 0.1f,
                   "Waveform analysis did not capture audio energy."))
    {
        file.deleteFile();
        return 1;
    }
    file.deleteFile();
    std::cout << "Audio engine command validation tests passed.\n";
    return 0;
}
