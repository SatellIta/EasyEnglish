export function speak(text: string): boolean {
  if (!('speechSynthesis' in window) || !text.trim()) return false

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.rate = 0.92
  utterance.pitch = 1

  const voices = window.speechSynthesis.getVoices()
  const preferred =
    voices.find(
      (voice) =>
        voice.lang.startsWith('en') &&
        /Samantha|Google US English|Microsoft Aria|Natural|Jenny/i.test(voice.name),
    ) ??
    voices.find((voice) => voice.lang === 'en-US') ??
    voices.find((voice) => voice.lang.startsWith('en'))

  if (preferred) utterance.voice = preferred
  window.speechSynthesis.speak(utterance)
  return true
}
