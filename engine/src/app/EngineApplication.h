#pragma once

#include "../audio/AudioEngine.h"
#include <juce_gui_basics/juce_gui_basics.h>

#include <memory>
#include <atomic>
#include <mutex>
#include <thread>

namespace skvdj
{
class EngineApplication final : public juce::JUCEApplication, private juce::Timer
{
public:
    const juce::String getApplicationName() override { return "SIR. KEVIN Audio Engine"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return false; }
    void initialise(const juce::String&) override;
    void shutdown() override;
    void systemRequestedQuit() override;

private:
    void handleLine(const juce::String& line);
    void emitEvent(const juce::var& event, int requestId = 0, bool ok = true, const juce::String& error = {});
    void emitDeckState(int index, bool includeTrackDetails = false);
    juce::var createDeviceListEvent();
    void timerCallback() override;
    std::unique_ptr<AudioEngine> engine;
    std::thread commandThread;
    std::mutex outputMutex;
    std::atomic<bool> running { false };
};
}
