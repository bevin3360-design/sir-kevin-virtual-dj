#include "EngineApplication.h"
#include "../audio/AudioEngine.h"

#include <iostream>
#include <cmath>
#include <limits>

namespace skvdj
{
namespace
{
juce::var makeObject(std::initializer_list<std::pair<juce::Identifier, juce::var>> values)
{
    auto* object = new juce::DynamicObject();
    for (const auto& item : values)
        object->setProperty(item.first, item.second);
    return juce::var(object);
}

int deckIndexFor(const juce::var& value)
{
    const auto id = value.toString();
    for (int index = 0; index < deckCount; ++index)
        if (id == "deck-" + juce::String(index + 1))
            return index;
    return -1;
}

bool readFiniteNumber(const juce::var& value, double& output)
{
    if (!value.isInt() && !value.isInt64() && !value.isDouble())
        return false;
    output = static_cast<double>(value);
    return std::isfinite(output);
}
}

void EngineApplication::initialise(const juce::String&)
{
    engine = std::make_unique<AudioEngine>();
    const auto result = engine->start();
    running = true;
    emitEvent(makeObject({
        { "type", "engine.ready" },
        { "protocolVersion", 1 }
    }));
    if (result.failed())
        emitEvent(makeObject({
            { "type", "engine.error" },
            { "message", "No output device is active yet: " + result.getErrorMessage() },
            { "fatal", false }
        }));
    emitEvent(createDeviceListEvent());
    startTimerHz(15);
    commandThread = std::thread([this]
    {
        std::string line;
        while (std::getline(std::cin, line))
        {
            if (line.size() > 1'048'576)
            {
                emitEvent(makeObject({
                    { "type", "engine.error" },
                    { "message", "Protocol message exceeded the one-megabyte limit." },
                    { "fatal", false }
                }));
                continue;
            }
            handleLine(juce::String::fromUTF8(line.c_str()));
        }
        juce::MessageManager::callAsync([this] { quit(); });
    });
}

void EngineApplication::shutdown()
{
    running = false;
    stopTimer();
    if (commandThread.joinable())
        commandThread.join();
    engine.reset();
}

void EngineApplication::systemRequestedQuit()
{
    quit();
}

void EngineApplication::handleLine(const juce::String& line)
{
    const auto parsed = juce::JSON::parse(line);
    if (!parsed.isObject())
    {
        emitEvent(makeObject({
            { "type", "engine.error" },
            { "message", "Invalid JSON request." },
            { "fatal", false }
        }));
        return;
    }
    const auto request = parsed.getDynamicObject();
    const auto requestIdValue = request->getProperty("requestId");
    double requestIdNumber = 0.0;
    const auto protocolVersion = request->getProperty("protocolVersion");
    double protocolVersionNumber = 0.0;
    if (!readFiniteNumber(requestIdValue, requestIdNumber)
        || !readFiniteNumber(protocolVersion, protocolVersionNumber)
        || requestIdNumber < 1.0
        || requestIdNumber > static_cast<double>(std::numeric_limits<int>::max())
        || std::floor(requestIdNumber) != requestIdNumber
        || protocolVersionNumber != 1.0)
    {
        const auto requestId = requestIdNumber <= static_cast<double>(std::numeric_limits<int>::max())
            ? static_cast<int>(requestIdNumber) : 0;
        emitEvent(makeObject({
            { "type", "engine.error" },
            { "message", "Unsupported protocol version or invalid request ID." },
            { "fatal", false }
        }), requestId, false, "Unsupported protocol version or invalid request ID.");
        return;
    }
    const auto requestId = static_cast<int>(requestIdNumber);

    const auto command = request->getProperty("command");
    if (!command.isObject())
    {
        emitEvent(makeObject({
            { "type", "engine.error" },
            { "message", "Missing command object." },
            { "fatal", false }
        }), requestId, false, "Missing command object.");
        return;
    }

    const auto* object = command.getDynamicObject();
    const auto type = object->getProperty("type").toString();
    auto error = juce::String {};
    auto result = juce::Result::ok();

    if (type == "devices.list")
    {
        emitEvent(createDeviceListEvent(), requestId);
        return;
    }
    if (type == "devices.select")
    {
        const auto deviceName = object->getProperty("deviceName");
        if (!deviceName.isString() || deviceName.toString().length() > 512)
            result = juce::Result::fail("Invalid audio device name.");
        else
            result = engine->selectOutputDevice(deviceName.toString());
        if (result.wasOk())
            emitEvent(createDeviceListEvent());
    }
    else if (type == "master.gain")
    {
        double gain = 0.0;
        if (!readFiniteNumber(object->getProperty("gain"), gain) || gain < 0.0 || gain > 1.5)
            result = juce::Result::fail("Master gain must be between 0.0 and 1.5.");
        else
            engine->setMasterGain(static_cast<float>(gain));
    }
    else if (type == "mixer.crossfader")
    {
        double position = 0.0;
        if (!readFiniteNumber(object->getProperty("position"), position) || position < -1.0 || position > 1.0)
            result = juce::Result::fail("Crossfader position must be between -1 and 1.");
        else
            engine->setCrossfader(static_cast<float>(position));
    }
    else if (type == "mixer.headphone-gain")
    {
        double gain = 0.0;
        if (!readFiniteNumber(object->getProperty("gain"), gain) || gain < 0.0 || gain > 1.5)
            result = juce::Result::fail("Headphone gain must be between 0 and 1.5.");
        else
            engine->setHeadphoneGain(static_cast<float>(gain));
    }
    else
    {
        const auto deckIndex = deckIndexFor(object->getProperty("deckId"));
        if (deckIndex < 0)
            result = juce::Result::fail("Unknown deck ID.");
        else if (type == "deck.load")
        {
            const auto pathValue = object->getProperty("path");
            const auto path = pathValue.toString();
            if (!pathValue.isString() || path.isEmpty() || path.length() > 32768)
                result = juce::Result::fail("Invalid audio file path.");
            else
            {
                result = engine->loadTrack(deckIndex, juce::File(path));
                if (result.wasOk())
                    emitDeckState(deckIndex, true);
            }
        }
        else if (type == "deck.play")
            result = engine->play(deckIndex);
        else if (type == "deck.pause")
            result = engine->pause(deckIndex);
        else if (type == "deck.stop")
            result = engine->stop(deckIndex);
        else if (type == "deck.seek")
        {
            double position = 0.0;
            if (!readFiniteNumber(object->getProperty("positionSeconds"), position))
                result = juce::Result::fail("Invalid seek position.");
            else
                result = engine->seek(deckIndex, position);
        }
        else if (type == "deck.gain")
        {
            double gain = 0.0;
            if (!readFiniteNumber(object->getProperty("gain"), gain))
                result = juce::Result::fail("Invalid deck gain.");
            else
                result = engine->setDeckGain(deckIndex, static_cast<float>(gain));
        }
        else if (type == "deck.eq")
        {
            double low = 0.0, mid = 0.0, high = 0.0;
            if (!readFiniteNumber(object->getProperty("lowDb"), low)
                || !readFiniteNumber(object->getProperty("midDb"), mid)
                || !readFiniteNumber(object->getProperty("highDb"), high))
                result = juce::Result::fail("Invalid EQ band values.");
            else
                result = engine->setDeckEq(deckIndex, static_cast<float>(low), static_cast<float>(mid), static_cast<float>(high));
        }
        else if (type == "deck.cue")
        {
            const auto enabled = object->getProperty("enabled");
            if (!enabled.isBool())
                result = juce::Result::fail("Invalid headphone cue setting.");
            else
                result = engine->setDeckCue(deckIndex, static_cast<bool>(enabled));
        }
        else
            result = juce::Result::fail("Unsupported engine command.");
        if (result.failed())
            error = result.getErrorMessage();
        else
            emitDeckState(deckIndex);
    }

    if (result.failed())
        error = result.getErrorMessage();
    emitEvent(makeObject({
        { "type", "diagnostic" },
        { "message", result.failed() ? error : "Command completed." }
    }), requestId, result.wasOk(), error);
}

void EngineApplication::emitEvent(const juce::var& event, int requestId, bool ok, const juce::String& error)
{
    const std::lock_guard<std::mutex> lock(outputMutex);
    auto response = makeObject({
        { "protocolVersion", 1 },
        { "event", event }
    });
    auto* object = response.getDynamicObject();
    if (requestId > 0)
    {
        object->setProperty("requestId", requestId);
        object->setProperty("ok", ok);
        if (error.isNotEmpty())
            object->setProperty("error", error);
    }
    const auto serialized = juce::JSON::toString(response, true);
    std::cout << serialized.toStdString() << '\n' << std::flush;
}

void EngineApplication::emitDeckState(int index, bool includeTrackDetails)
{
    const auto snapshot = engine->deckSnapshot(index, includeTrackDetails);
    emitEvent(makeObject({
        { "type", "deck.state" },
        { "deckId", "deck-" + juce::String(index + 1) },
        { "loaded", snapshot.loaded },
        { "playing", snapshot.playing },
        { "positionSeconds", snapshot.positionSeconds },
        { "durationSeconds", snapshot.durationSeconds },
        { "gain", snapshot.gain },
        { "lowDb", snapshot.lowDb },
        { "midDb", snapshot.midDb },
        { "highDb", snapshot.highDb },
        { "cue", snapshot.cue }
    }));
    if (snapshot.loaded && includeTrackDetails)
    {
        juce::Array<juce::var> waveformPeaks;
        for (const auto peak : snapshot.waveformPeaks)
            waveformPeaks.add(peak);
        emitEvent(makeObject({
            { "type", "deck.loaded" },
            { "deckId", "deck-" + juce::String(index + 1) },
            { "name", snapshot.name },
            { "durationSeconds", snapshot.durationSeconds },
            { "waveformPeaks", juce::var(waveformPeaks) }
        }));
    }
}

void EngineApplication::timerCallback()
{
    if (!running || engine == nullptr)
        return;
    for (int index = 0; index < deckCount; ++index)
        emitDeckState(index);
}

juce::var EngineApplication::createDeviceListEvent()
{
    auto devices = engine->outputDevices();
    juce::Array<juce::var> items;
    for (const auto& device : devices)
        items.add(device);
    return makeObject({
        { "type", "devices.list" },
        { "devices", juce::var(items) },
        { "activeDevice", engine->activeOutputDevice() },
        { "sampleRate", engine->outputSampleRate() },
        { "bufferSize", engine->outputBufferSize() },
        { "outputChannels", engine->outputChannelCount() }
    });
}
}
