#pragma once

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_utils/juce_audio_utils.h>

#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace skvdj
{
inline constexpr int deckCount = 4;

struct DeckSnapshot
{
    bool loaded = false;
    bool playing = false;
    double positionSeconds = 0.0;
    double durationSeconds = 0.0;
    float gain = 1.0f;
    float lowDb = 0.0f;
    float midDb = 0.0f;
    float highDb = 0.0f;
    bool cue = false;
    juce::String name;
    std::vector<float> waveformPeaks;
};

class AudioEngine final : private juce::AudioIODeviceCallback
{
public:
    AudioEngine();
    ~AudioEngine() override;

    AudioEngine(const AudioEngine&) = delete;
    AudioEngine& operator=(const AudioEngine&) = delete;

    juce::Result start();
    juce::Result selectOutputDevice(const juce::String& deviceName);
    juce::StringArray outputDevices();
    juce::String activeOutputDevice() const;
    double outputSampleRate() const;
    int outputBufferSize() const;

    juce::Result loadTrack(int deckIndex, const juce::File& file);
    juce::Result play(int deckIndex);
    juce::Result pause(int deckIndex);
    juce::Result stop(int deckIndex);
    juce::Result seek(int deckIndex, double positionSeconds);
    juce::Result setDeckGain(int deckIndex, float gain);
    juce::Result setDeckEq(int deckIndex, float lowDb, float midDb, float highDb);
    juce::Result setDeckCue(int deckIndex, bool enabled);
    void setCrossfader(float position);
    void setHeadphoneGain(float gain);
    int outputChannelCount() const;
    void setMasterGain(float gain);
    DeckSnapshot deckSnapshot(int deckIndex, bool includeWaveform = false) const;

private:
    struct TrackData
    {
        juce::AudioBuffer<float> audio;
        double sampleRate = 44100.0;
        juce::String name;
        std::vector<float> waveformPeaks;
    };

    struct Deck
    {
        std::atomic<const TrackData*> track { nullptr };
        std::atomic<const TrackData*> audioThreadHazard { nullptr };
        mutable std::atomic<const TrackData*> snapshotHazard { nullptr };
        std::atomic<bool> playing { false };
        std::atomic<float> gain { 1.0f };
        std::atomic<float> lowDb { 0.0f };
        std::atomic<float> midDb { 0.0f };
        std::atomic<float> highDb { 0.0f };
        std::atomic<bool> cue { false };
        std::atomic<double> positionFrames { 0.0 };
        std::atomic<double> requestedPositionFrames { 0.0 };
        std::atomic<std::uint64_t> seekSequence { 0 };
        std::uint64_t audioThreadSeekSequence = 0;
        std::array<float, 2> lowState {};
        std::array<float, 2> highState {};
        std::vector<std::unique_ptr<TrackData>> retiredTracks;
    };

    void audioDeviceIOCallbackWithContext(
        const float* const* inputChannelData,
        int numInputChannels,
        float* const* outputChannelData,
        int numOutputChannels,
        int numSamples,
        const juce::AudioIODeviceCallbackContext& context) override;
    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;
    void reclaimRetiredTracks();
    static bool isValidDeckIndex(int deckIndex) noexcept;

    juce::AudioDeviceManager deviceManager;
    std::array<Deck, deckCount> decks;
    std::vector<std::unique_ptr<TrackData>> ownedTracks;
    std::atomic<float> masterGain { 1.0f };
    std::atomic<float> crossfader { 0.0f };
    std::atomic<float> headphoneGain { 1.0f };
    std::atomic<double> deviceSampleRate { 44100.0 };
    std::atomic<int> deviceBlockSize { 0 };
    std::atomic<int> outputChannels { 2 };
    std::atomic<bool> started { false };
    juce::AudioFormatManager formats;
};
}
