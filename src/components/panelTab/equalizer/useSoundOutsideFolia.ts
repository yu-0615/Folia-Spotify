import { omni } from '../../../services/onlineMusic/omni';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';

// src/components/panelTab/equalizer/useSoundOutsideFolia.ts
// Whether the song playing sounds outside Folia's audio: its deck holds a stand-in
// (`ProviderAudioSource.standIn`), and the song itself plays in the platform's own player or on
// another device. The equalizer and the effects work on the deck, so they cannot reach it.

export const useSoundOutsideFolia = (): boolean => (
    usePlaybackStore(state => Boolean(state.audioSrc) && omni.isStandInAudioSource(state.audioSrc!))
);
