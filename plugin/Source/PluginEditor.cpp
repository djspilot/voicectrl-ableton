#include "PluginEditor.h"

namespace voicectrl
{
VoiceCtrlEditor::VoiceCtrlEditor (VoiceCtrlProcessor& p)
    : juce::AudioProcessorEditor (p), proc (p)
{
    setSize (560, 360);

    titleLabel.setText ("VoiceCtrl — local voice → Ableton",
                        juce::dontSendNotification);
    titleLabel.setFont (juce::Font (juce::FontOptions (16.0f).withStyle ("Bold")));
    titleLabel.setColour (juce::Label::textColourId, juce::Colours::white);
    addAndMakeVisible (titleLabel);

    statusLabel.setText ("starting…", juce::dontSendNotification);
    statusLabel.setColour (juce::Label::textColourId, juce::Colours::lightgrey);
    addAndMakeVisible (statusLabel);

    micButton.setColour (juce::TextButton::buttonColourId, juce::Colour (0xffffae00));
    micButton.setColour (juce::TextButton::buttonOnColourId, juce::Colour (0xffff5560));
    micButton.setColour (juce::TextButton::textColourOffId, juce::Colours::black);
    micButton.setColour (juce::TextButton::textColourOnId,  juce::Colours::white);
    micButton.setClickingTogglesState (true);
    micButton.onClick = [this]
    {
        if (micButton.getToggleState())
        {
            micButton.setButtonText ("■ Stop");
            proc.startListening();
            appendLog ("listening…");
        }
        else
        {
            micButton.setButtonText ("● Listen");
            proc.stopListeningAndProcess();
        }
    };
    addAndMakeVisible (micButton);

    logBox.setReadOnly (true);
    logBox.setMultiLine (true, false);
    logBox.setScrollbarsShown (true);
    logBox.setColour (juce::TextEditor::backgroundColourId, juce::Colour (0xff141414));
    logBox.setColour (juce::TextEditor::textColourId,       juce::Colour (0xffd0d0d0));
    logBox.setColour (juce::TextEditor::outlineColourId,    juce::Colour (0xff2a2a2a));
    logBox.setFont (juce::Font (juce::FontOptions ("Menlo", 12.0f, juce::Font::plain)));
    addAndMakeVisible (logBox);

    proc.pipeline.setLogger ([this] (const juce::String& s) { appendLog (s); });
    appendLog ("VoiceCtrl ready. Route mic into this track and click Listen.");

    startTimerHz (30);
}

VoiceCtrlEditor::~VoiceCtrlEditor()
{
    proc.pipeline.setLogger (nullptr);
    stopTimer();
}

void VoiceCtrlEditor::appendLog (const juce::String& s)
{
    logBox.moveCaretToEnd();
    logBox.insertTextAtCaret (s + "\n");
}

void VoiceCtrlEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff1c1c1c));

    // level meter ring around the button
    const auto b = micButton.getBounds().toFloat().expanded (16.0f);
    g.setColour (juce::Colour (0xff2a2a2a));
    g.drawEllipse (b, 4.0f);
    if (meterLevel > 0.001f)
    {
        const float lvl = juce::jlimit (0.0f, 1.0f, meterLevel * 4.0f);
        g.setColour (juce::Colour::fromFloatRGBA (1.0f, 0.68f, 0.0f, lvl));
        g.drawEllipse (b.reduced (4.0f - lvl * 4.0f), 4.0f + lvl * 4.0f);
    }
}

void VoiceCtrlEditor::resized()
{
    auto r = getLocalBounds().reduced (16);
    titleLabel.setBounds (r.removeFromTop (24));
    statusLabel.setBounds (r.removeFromBottom (20));
    auto top = r.removeFromTop (140);
    micButton.setBounds (top.withSizeKeepingCentre (120, 120));
    logBox.setBounds (r.reduced (0, 8));
}

void VoiceCtrlEditor::timerCallback()
{
    meterLevel = meterLevel * 0.6f + proc.getCurrentLevel() * 0.4f;
    repaint (micButton.getBounds().expanded (24));

    juce::String status;
    status << "Ableton: " << (proc.pipeline.isAbletonOnline() ? juce::String (juce::CharPointer_UTF8 ("✓"))
                                                              : juce::String (juce::CharPointer_UTF8 ("✗")))
           << "   Ollama: "  << (proc.pipeline.isOllamaOnline()  ? juce::String (juce::CharPointer_UTF8 ("✓"))
                                                              : juce::String (juce::CharPointer_UTF8 ("✗")));
    statusLabel.setText (status, juce::dontSendNotification);
}
}
