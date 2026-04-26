#include "PluginEditor.h"

namespace voicectrl
{
VoiceCtrlEditor::VoiceCtrlEditor (VoiceCtrlProcessor& p)
    : juce::AudioProcessorEditor (p), proc (p)
{
    setSize (380, 360);

    titleLabel.setText ("VoiceCtrl - local voice for Ableton",
                        juce::dontSendNotification);
    titleLabel.setFont (juce::Font (juce::FontOptions (14.0f).withStyle ("Bold")));
    titleLabel.setColour (juce::Label::textColourId, juce::Colour (0xffe8e8e8));
    titleLabel.setJustificationType (juce::Justification::centred);
    addAndMakeVisible (titleLabel);

    statusLabel.setFont (juce::Font (juce::FontOptions (11.0f)));
    statusLabel.setColour (juce::Label::textColourId, juce::Colour (0xff909090));
    statusLabel.setJustificationType (juce::Justification::centred);
    addAndMakeVisible (statusLabel);

    micButton.setColour (juce::TextButton::buttonColourId,   juce::Colour (0xffffae00));
    micButton.setColour (juce::TextButton::buttonOnColourId, juce::Colour (0xffff5560));
    micButton.setColour (juce::TextButton::textColourOffId,  juce::Colours::black);
    micButton.setColour (juce::TextButton::textColourOnId,   juce::Colours::white);
    micButton.setClickingTogglesState (true);
    micButton.setButtonText ("Listen");
    micButton.onClick = [this]
    {
        if (micButton.getToggleState())
        {
            micButton.setButtonText ("Stop");
            proc.startListening();
            appendLog ("listening...");
        }
        else
        {
            micButton.setButtonText ("Listen");
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
    logBox.setFont (juce::Font (juce::FontOptions ("Menlo", 11.0f, juce::Font::plain)));
    addAndMakeVisible (logBox);

    proc.pipeline.setLogger ([this] (const juce::String& s) { appendLog (s); });
    appendLog ("VoiceCtrl ready. Click Listen and speak.");

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

    // Pulsing level ring around the mic button (Melosurf-style)
    const auto bb  = micButton.getBounds().toFloat();
    const auto cx  = bb.getCentreX();
    const auto cy  = bb.getCentreY();
    const float r0 = juce::jmax (bb.getWidth(), bb.getHeight()) * 0.5f + 6.0f;

    g.setColour (juce::Colour (0xff2a2a2a));
    g.drawEllipse (cx - r0, cy - r0, r0 * 2, r0 * 2, 2.0f);

    if (meterLevel > 0.001f)
    {
        const float lvl = juce::jlimit (0.0f, 1.0f, meterLevel * 4.0f);
        g.setColour (juce::Colour::fromFloatRGBA (1.0f, 0.68f, 0.0f, lvl));
        const float r1 = r0 + 4.0f + lvl * 18.0f;
        g.drawEllipse (cx - r1, cy - r1, r1 * 2, r1 * 2, 2.0f + lvl * 4.0f);
    }
}

void VoiceCtrlEditor::resized()
{
    auto r = getLocalBounds().reduced (12);

    titleLabel.setBounds (r.removeFromTop (22));
    statusLabel.setBounds (r.removeFromTop (16));

    // mic button: large, centered, at the BOTTOM (Melosurf-style)
    auto bottom = r.removeFromBottom (140);
    auto btn = juce::Rectangle<int> (0, 0, 90, 90)
                   .withCentre ({ bottom.getCentreX(), bottom.getCentreY() });
    micButton.setBounds (btn);

    // log fills the middle
    logBox.setBounds (r.reduced (0, 6));
}

void VoiceCtrlEditor::timerCallback()
{
    meterLevel = meterLevel * 0.6f + proc.getCurrentLevel() * 0.4f;
    repaint();

    juce::String status;
    status << "Ableton: " << (proc.pipeline.isAbletonOnline() ? "OK" : "X")
           << "    Ollama: " << (proc.pipeline.isOllamaOnline() ? "OK" : "X");
    statusLabel.setText (status, juce::dontSendNotification);
}
}
