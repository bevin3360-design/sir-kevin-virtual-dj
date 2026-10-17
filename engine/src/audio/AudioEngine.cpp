#include "AudioEngine.h"

#include <algorithm>
#include <cmath>

namespace skvdj
{
AudioEngine::AudioEngine()
{
    formats.registerBasicFormats();
}

AudioEngine::~AudioEngine()
{
    if (started.exchange(false))
        deviceManager.removeAudioCallback(this);
    deviceManager.closeAudioDevice();
}

juce::Result AudioEngine::start()
{
    if (started.load())
        return juce::Result::ok();

    const auto error = deviceManager.initialise(0, 2, nullptr, true);
    deviceManager.addAudioCallback(this);
    started.store(true);
    return error.isEmpty() ? juce::Result::ok() : juce::Result::fail(error);
}

juce::Result AudioEngine::selectOutputDevice(const juce::String& deviceName)
{
    auto setup = deviceManager.getAudioDeviceSetup();
    setup.outputDeviceName = deviceName;
    setup.useDefaultOutputChannels = false;
    setup.outputChannels.clear();
    int selectedChannels = 0;
    for (auto* type : deviceManager.getAvailableDeviceTypes())
    {
        if (type == nullptr)
            continue;
        type->scanForDevices();
        if (!type->getDeviceNames(false).contains(deviceName))
            continue;
        std::unique_ptr<juce::AudioIODevice> probe(type->createDevice(deviceName, {}));
        if (probe == nullptr)
            continue;
        selectedChannels = juce::jmin(4, probe->getOutputChannelNames().size());
        break;
    }
    if (selectedChannels > 0)
        setup.outputChannels.setRange(0, selectedChannels, true);
    else
    {
        setup.useDefaultOutputChannels = true;
    }
    setup.inputDeviceName.clear();
    setup.useDefaultInputChannels = false;
    const auto error = deviceManager.setAudioDeviceSetup(setup, true);
    if (error.isEmpty() && deviceManager.getCurrentAudioDevice() != nullptr)
        outputChannels.store(deviceManager.getCurrentAudioDevice()->getActiveOutputChannels().countNumberOfSetBits());
    return error.isEmpty() ? juce::Result::ok() : juce::Result::fail(error);
}

juce::StringArray AudioEngine::outputDevices()
{
    juce::StringArray result;
    for (auto* type : deviceManager.getAvailableDeviceTypes())
    {
        if (type == nullptr)
            continue;
        type->scanForDevices();
        result.addArray(type->getDeviceNames(false));
    }
    result.removeDuplicates(false);
    return result;
}

juce::String AudioEngine::activeOutputDevice() const
{
    return deviceManager.getCurrentAudioDevice() != nullptr
        ? deviceManager.getCurrentAudioDevice()->getName()
        : juce::String {};
}

double AudioEngine::outputSampleRate() const
{
    return deviceSampleRate.load();
}

int AudioEngine::outputBufferSize() const
{
    return deviceBlockSize.load();
}

int AudioEngine::outputChannelCount() const
{
    return deviceManager.getCurrentAudioDevice() != nullptr ? outputChannels.load() : 0;
}

juce::Result AudioEngine::loadTrack(int deckIndex, const juce::File& file)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    if (!file.existsAsFile())
        return juce::Result::fail("The selected audio file does not exist.");

    std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(file));
    if (reader == nullptr)
        return juce::Result::fail("This audio format is not supported by the audio engine.");
    if (reader->lengthInSamples <= 0 || reader->lengthInSamples > reader->sampleRate * 60.0 * 60.0 * 2.0)
        return juce::Result::fail("The audio file is empty or exceeds the two-hour import limit.");
    if (reader->numChannels < 1 || reader->numChannels > 8)
        return juce::Result::fail("The audio file must have between one and eight channels.");
    const auto decodedBytes = static_cast<std::uint64_t>(reader->lengthInSamples)
        * reader->numChannels * sizeof(float);
    if (decodedBytes > 512ULL * 1024ULL * 1024ULL)
        return juce::Result::fail("The decoded audio file exceeds the 512 MiB per-deck memory limit.");

    auto track = std::make_unique<TrackData>();
    track->audio.setSize(static_cast<int>(reader->numChannels), static_cast<int>(reader->lengthInSamples));
    if (!reader->read(&track->audio, 0, static_cast<int>(reader->lengthInSamples), 0, true, true))
        return juce::Result::fail("The audio file could not be decoded.");
    track->sampleRate = reader->sampleRate;
    track->name = file.getFileName();
    constexpr int waveformPeakCount = 512;
    track->waveformPeaks.resize(waveformPeakCount);
    const auto framesPerPeak = juce::jmax(1, track->audio.getNumSamples() / waveformPeakCount);
    for (int peakIndex = 0; peakIndex < waveformPeakCount; ++peakIndex)
    {
        const auto start = peakIndex * framesPerPeak;
        const auto end = peakIndex == waveformPeakCount - 1
            ? track->audio.getNumSamples()
            : juce::jmin(start + framesPerPeak, track->audio.getNumSamples());
        float peak = 0.0f;
        for (int channel = 0; channel < track->audio.getNumChannels(); ++channel)
            for (int frame = start; frame < end; ++frame)
                peak = juce::jmax(peak, std::abs(track->audio.getSample(channel, frame)));
        track->waveformPeaks[static_cast<std::size_t>(peakIndex)] = juce::jmin(1.0f, peak);
    }

    auto& deck = decks[static_cast<std::size_t>(deckIndex)];
    deck.playing.store(false);
    const auto* previous = deck.track.exchange(track.get());
    deck.positionFrames.store(0.0);
    deck.requestedPositionFrames.store(0.0);
    deck.seekSequence.fetch_add(1);
    ownedTracks.push_back(std::move(track));
    if (previous != nullptr)
    {
        auto oldTrack = std::find_if(ownedTracks.begin(), ownedTracks.end(),
            [previous](const auto& item) { return item.get() == previous; });
        if (oldTrack != ownedTracks.end())
        {
            deck.retiredTracks.push_back(std::move(*oldTrack));
            ownedTracks.erase(oldTrack);
        }
    }
    reclaimRetiredTracks();
    return juce::Result::ok();
}

juce::Result AudioEngine::play(int deckIndex)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    auto& deck = decks[static_cast<std::size_t>(deckIndex)];
    if (deck.track.load() == nullptr)
        return juce::Result::fail("Load a track into this deck before playing.");
    const auto track = deck.track.load();
    if (deck.positionFrames.load() >= track->audio.getNumSamples())
    {
        deck.requestedPositionFrames.store(0.0);
        deck.seekSequence.fetch_add(1);
    }
    deck.playing.store(true);
    return juce::Result::ok();
}

juce::Result AudioEngine::pause(int deckIndex)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    decks[static_cast<std::size_t>(deckIndex)].playing.store(false);
    return juce::Result::ok();
}

juce::Result AudioEngine::stop(int deckIndex)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    auto& deck = decks[static_cast<std::size_t>(deckIndex)];
    deck.playing.store(false);
    deck.positionFrames.store(0.0);
    deck.requestedPositionFrames.store(0.0);
    deck.seekSequence.fetch_add(1);
    return juce::Result::ok();
}

juce::Result AudioEngine::seek(int deckIndex, double positionSeconds)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    if (!std::isfinite(positionSeconds) || positionSeconds < 0.0)
        return juce::Result::fail("Seek position must be a finite, non-negative number.");
    const auto* track = decks[static_cast<std::size_t>(deckIndex)].track.load();
    if (track == nullptr)
        return juce::Result::fail("Load a track into this deck before seeking.");
    const auto frame = std::clamp(positionSeconds * track->sampleRate, 0.0,
                                  static_cast<double>(track->audio.getNumSamples()));
    auto& deck = decks[static_cast<std::size_t>(deckIndex)];
    deck.positionFrames.store(frame);
    deck.requestedPositionFrames.store(frame);
    deck.seekSequence.fetch_add(1);
    return juce::Result::ok();
}

juce::Result AudioEngine::setDeckGain(int deckIndex, float gain)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    if (!std::isfinite(gain) || gain < 0.0f || gain > 1.5f)
        return juce::Result::fail("Deck gain must be between 0.0 and 1.5.");
    decks[static_cast<std::size_t>(deckIndex)].gain.store(gain);
    return juce::Result::ok();
}

juce::Result AudioEngine::setDeckEq(int deckIndex, float lowDb, float midDb, float highDb)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    if (!std::isfinite(lowDb) || !std::isfinite(midDb) || !std::isfinite(highDb)
        || lowDb < -24.0f || lowDb > 12.0f
        || midDb < -24.0f || midDb > 12.0f
        || highDb < -24.0f || highDb > 12.0f)
        return juce::Result::fail("EQ bands must be between -24 dB and +12 dB.");
    auto& deck = decks[static_cast<std::size_t>(deckIndex)];
    deck.lowDb.store(lowDb);
    deck.midDb.store(midDb);
    deck.highDb.store(highDb);
    return juce::Result::ok();
}

juce::Result AudioEngine::setDeckCue(int deckIndex, bool enabled)
{
    if (!isValidDeckIndex(deckIndex))
        return juce::Result::fail("Deck ID is out of range.");
    if (enabled && (outputChannels.load() < 4 || deviceManager.getCurrentAudioDevice() == nullptr))
        return juce::Result::fail("Headphone cue requires an audio device with at least four output channels.");
    decks[static_cast<std::size_t>(deckIndex)].cue.store(enabled);
    return juce::Result::ok();
}

void AudioEngine::setCrossfader(float position)
{
    if (std::isfinite(position))
        crossfader.store(std::clamp(position, -1.0f, 1.0f));
}

void AudioEngine::setHeadphoneGain(float gain)
{
    if (std::isfinite(gain))
        headphoneGain.store(std::clamp(gain, 0.0f, 1.5f));
}

void AudioEngine::setMasterGain(float gain)
{
    if (std::isfinite(gain))
        masterGain.store(std::clamp(gain, 0.0f, 1.5f));
}

DeckSnapshot AudioEngine::deckSnapshot(int deckIndex, bool includeWaveform) const
{
    DeckSnapshot snapshot;
    if (!isValidDeckIndex(deckIndex))
        return snapshot;
    const auto& deck = decks[static_cast<std::size_t>(deckIndex)];
    const auto* track = deck.track.load();
    deck.snapshotHazard.store(track);
    if (track == nullptr || track != deck.track.load())
    {
        deck.snapshotHazard.store(nullptr);
        return snapshot;
    }
    snapshot.loaded = true;
    snapshot.playing = deck.playing.load();
    snapshot.positionSeconds = deck.positionFrames.load() / track->sampleRate;
    snapshot.durationSeconds = track->audio.getNumSamples() / track->sampleRate;
    snapshot.gain = deck.gain.load();
    snapshot.lowDb = deck.lowDb.load();
    snapshot.midDb = deck.midDb.load();
    snapshot.highDb = deck.highDb.load();
    snapshot.cue = deck.cue.load();
    snapshot.name = track->name;
    if (includeWaveform)
        snapshot.waveformPeaks = track->waveformPeaks;
    deck.snapshotHazard.store(nullptr);
    return snapshot;
}

void AudioEngine::audioDeviceIOCallbackWithContext(
    const float* const*,
    int,
    float* const* outputChannelData,
    int numOutputChannels,
    int numSamples,
    const juce::AudioIODeviceCallbackContext&)
{
    for (int channel = 0; channel < numOutputChannels; ++channel)
        if (outputChannelData[channel] != nullptr)
            juce::FloatVectorOperations::clear(outputChannelData[channel], numSamples);

    const auto outputRate = deviceSampleRate.load();
    const auto xfade = (crossfader.load() + 1.0f) * 0.5f;
    const auto angle = xfade * juce::MathConstants<float>::halfPi;
    const auto leftFade = std::cos(angle);
    const auto rightFade = std::sin(angle);
    const auto lowAlpha = 1.0f - std::exp(-juce::MathConstants<float>::twoPi * 180.0f / static_cast<float>(outputRate));
    const auto highAlpha = 1.0f - std::exp(-juce::MathConstants<float>::twoPi * 3200.0f / static_cast<float>(outputRate));
    float masterPeak = 0.0f;
    float headphonePeak = 0.0f;
    for (std::size_t deckIndex = 0; deckIndex < decks.size(); ++deckIndex)
    {
        auto& deck = decks[deckIndex];
        const auto* track = deck.track.load();
        deck.audioThreadHazard.store(track);
        if (track == nullptr || track != deck.track.load())
        {
            deck.audioThreadHazard.store(nullptr);
            continue;
        }

        const auto sequence = deck.seekSequence.load();
        if (sequence != deck.audioThreadSeekSequence)
        {
            deck.positionFrames.store(deck.requestedPositionFrames.load());
            deck.audioThreadSeekSequence = sequence;
        }
        if (!deck.playing.load())
        {
            deck.audioThreadHazard.store(nullptr);
            continue;
        }

        auto position = deck.positionFrames.load();
        const auto step = track->sampleRate / outputRate;
        const auto gain = deck.gain.load();
        const auto eqLow = std::pow(10.0f, deck.lowDb.load() / 20.0f);
        const auto eqMid = std::pow(10.0f, deck.midDb.load() / 20.0f);
        const auto eqHigh = std::pow(10.0f, deck.highDb.load() / 20.0f);
        const auto isLeft = deckIndex == 0 || deckIndex == 2;
        const auto channelFade = isLeft ? leftFade : rightFade;
        const auto headphoneEnabled = deck.cue.load() && numOutputChannels >= 4;
        const auto channels = track->audio.getNumChannels();
        const auto frames = track->audio.getNumSamples();

        for (int sample = 0; sample < numSamples && position < frames; ++sample, position += step)
        {
            const auto firstFrame = static_cast<int>(position);
            const auto secondFrame = std::min(firstFrame + 1, frames - 1);
            const auto fraction = static_cast<float>(position - firstFrame);
            float deckLeft = 0.0f;
            float deckRight = 0.0f;
            for (int outputChannel = 0; outputChannel < 2; ++outputChannel)
            {
                const auto sourceChannel = channels == 1 ? 0 : std::min(outputChannel, channels - 1);
                const auto first = track->audio.getSample(sourceChannel, firstFrame);
                const auto second = track->audio.getSample(sourceChannel, secondFrame);
                const auto source = first + (second - first) * fraction;
                deck.lowState[static_cast<std::size_t>(outputChannel)] +=
                    lowAlpha * (source - deck.lowState[static_cast<std::size_t>(outputChannel)]);
                deck.highState[static_cast<std::size_t>(outputChannel)] +=
                    highAlpha * (source - deck.highState[static_cast<std::size_t>(outputChannel)]);
                const auto low = deck.lowState[static_cast<std::size_t>(outputChannel)];
                const auto mid = deck.highState[static_cast<std::size_t>(outputChannel)] - low;
                const auto high = source - deck.highState[static_cast<std::size_t>(outputChannel)];
                const auto processed = (low * eqLow + mid * eqMid + high * eqHigh) * gain;
                if (outputChannel == 0)
                    deckLeft = processed;
                else
                    deckRight = processed;
            }
            if (channels == 1)
                deckRight = deckLeft;
            if (outputChannelData[0] != nullptr)
                outputChannelData[0][sample] += deckLeft * channelFade;
            if (numOutputChannels > 1 && outputChannelData[1] != nullptr)
                outputChannelData[1][sample] += deckRight * channelFade;
            if (headphoneEnabled && outputChannelData[2] != nullptr)
                outputChannelData[2][sample] += deckLeft;
            if (headphoneEnabled && outputChannelData[3] != nullptr)
                outputChannelData[3][sample] += deckRight;
        }
        deck.positionFrames.store(std::min(position, static_cast<double>(frames)));
        if (position >= frames)
            deck.playing.store(false);
        deck.audioThreadHazard.store(nullptr);
    }

    for (int channel = 0; channel < juce::jmin(2, numOutputChannels); ++channel)
    {
        if (outputChannelData[channel] == nullptr)
            continue;
        for (int sample = 0; sample < numSamples; ++sample)
            masterPeak = std::max(masterPeak, std::abs(outputChannelData[channel][sample]));
    }
    if (numOutputChannels >= 4)
        for (int channel = 2; channel < 4; ++channel)
            if (outputChannelData[channel] != nullptr)
                for (int sample = 0; sample < numSamples; ++sample)
                    headphonePeak = std::max(headphonePeak, std::abs(outputChannelData[channel][sample]));
    const auto master = masterGain.load();
    const auto limiter = masterPeak * master > 0.98f ? 0.98f / (masterPeak * master) : 1.0f;
    const auto finalGain = master * limiter;
    for (int channel = 0; channel < juce::jmin(2, numOutputChannels); ++channel)
        if (outputChannelData[channel] != nullptr)
            juce::FloatVectorOperations::multiply(outputChannelData[channel], finalGain, numSamples);
    const auto phonesGain = headphoneGain.load();
    const auto headphoneLimiter = headphonePeak * phonesGain > 0.98f
        ? 0.98f / (headphonePeak * phonesGain)
        : 1.0f;
    for (int channel = 2; channel < juce::jmin(4, numOutputChannels); ++channel)
        if (outputChannelData[channel] != nullptr)
            juce::FloatVectorOperations::multiply(outputChannelData[channel], phonesGain * headphoneLimiter, numSamples);
}

void AudioEngine::audioDeviceAboutToStart(juce::AudioIODevice* device)
{
    if (device == nullptr)
        return;
    deviceSampleRate.store(device->getCurrentSampleRate());
    deviceBlockSize.store(device->getCurrentBufferSizeSamples());
    outputChannels.store(device->getActiveOutputChannels().countNumberOfSetBits());
}

void AudioEngine::audioDeviceStopped()
{
    deviceBlockSize.store(0);
}

void AudioEngine::reclaimRetiredTracks()
{
    for (auto& deck : decks)
    {
        const auto* audioHazard = deck.audioThreadHazard.load();
        const auto* snapshotHazard = deck.snapshotHazard.load();
        std::erase_if(deck.retiredTracks, [audioHazard, snapshotHazard](const auto& track)
        {
            return track.get() != audioHazard && track.get() != snapshotHazard;
        });
    }
}

bool AudioEngine::isValidDeckIndex(int deckIndex) noexcept
{
    return deckIndex >= 0 && deckIndex < deckCount;
}
}
