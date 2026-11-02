# Echoes — Launch Video Plan

**Input:** Project (`monochrome-vercel` / Echoes)  
**Format:** Landscape (1920×1080), 30 fps  
**Target Duration:** 20.0 seconds (600 frames)  
**Tone:** `polished` (Clean, authoritative, cinematic, premium tech launch)  
**Voiceover:** Neural Voice (`en-US-ChristopherNeural` / `en-US-AndrewMultilingualNeural`)

---

## 1. Concept & Narrative Angle

Streaming services have become cluttered, ad-ridden, algorithmic walled gardens that demand \$12–20 every month. Echoes strips all of that away: a gorgeous, minimalist web client that streams hi-res audio, calibrates your headphones with 16-band AutoEQ, and lets you seamlessly hand off playback from your phone to your TV with zero configuration.

- **Angle:** Premium fidelity without the subscription tax.
- **The Hook:** A direct question to frustrated music listeners + the glowing waveform reveal.
- **Key Highlights:**
  1. Lossless & Hi-Res streaming with parametric AutoEQ & ReplayGain.
  2. Multi-platform instant playlist importer (Spotify & YouTube).
  3. Echoes Connect: Instant edge WebSocket playback handoff across Phone, Laptop, and TV.
- **Punchline:** "Your music, your devices, completely uncompromised."

---

## 2. Visual Identity & Design Tokens

- **Background:** Deep Obsidian Black (`#0a0b0e` to `#12131a` radial gradient with fine film grain).
- **Accents:** Electric Cyan (`#38bdf8`), Pure White (`#ffffff`), Muted Slate (`#94a3b8`), Success Emerald (`#10b981`).
- **Typography:** Inter (Headings: 700/800 bold tracking-tight; Body: 400/500 crisp).
- **Visuals:**
  - Official Echoes soundwave logo (`public/images/echoes_logo_white.png`).
  - Real Echoes UI components: Glassmorphic player controls, live audio frequency bars, device pairing badge.
  - Device handoff illustration: Laptop, Mobile, and Smart TV QR screen.

---

## 3. Scene-by-Scene Storyboard

| Scene | Time | Duration | Visual Elements | Spoken Voiceover |
|---|---|---|---|---|
| **Scene 1: The Hook** | 0.0s – 4.5s | 4.5s (135f) | Obsidian canvas. Glowing animated soundwave emblem expands with subtle lens flare. Bold headline: **"ECHOES"** • Tagline: *"Sound in its purest form."* | *"Tired of bloated streaming apps and monthly subscriptions? Meet Echoes."* |
| **Scene 2: Fidelity & Freedom** | 4.5s – 9.5s | 5.0s (150f) | Floating glass player card with real playback UI and live equalizer spectrum bars. Feature pills pop in: `Lossless Audio`, `16-Band AutoEQ`, `Zero Ads`, `Spotify Import`. | *"Lossless, crystal-clear audio. 16-band headphone correction. And zero ads. Ever."* |
| **Scene 3: Echoes Connect** | 9.5s – 15.5s | 6.0s (180f) | Cross-device continuum visual. Phone playback smoothly transfers to Smart TV via live QR code scan. Real-time edge sync wave pulse. Pill: `Instant Handoff • Cloudflare Edge`. | *"With Echoes Connect, your music follows you everywhere. Switch from your phone to your living room TV in a heartbeat."* |
| **Scene 4: The Outro (Settled Poster)** | 15.5s – 20.0s | 4.5s (135f) | Unified brand outro. Echoes emblem settles with subtle breathing pulse. Headline: **"ECHOES"** • Sub: *"Your Music. Uncompromised."* • Badges: `100% Free` • `Open Source` • `Self-Hostable`. | *"Your music, your devices, completely uncompromised. Listen now."* |

---

## 4. Audio & Mix Design

1. **Voiceover Track:** Studio-mastered neural voiceover with gentle high-pass filter, mild compression, and presence boost.
2. **Music Bed:** Driving, sophisticated ambient synthwave track in D minor (118 BPM) with rich sub-bass, atmospheric pads, and crisp syncopated percussion.
3. **Sound Design FX:**
   - Scene 1: Low sub-bass riser and air swell into logo hit.
   - Scene 2: High-tech digital shimmer / whoosh on player card reveal.
   - Scene 3: Clean connection ping / ultrasonic chirp on device handoff.
   - Scene 4: Deep final chord impact with gentle tape decay.
4. **Mix:** Voiceover sits cleanly in the pocket (+3dB over music), music bed ducked by 3.5dB during speech, SFX tucked softly beneath the music.

---

## 5. Deliverables Checklist
- [x] `brag-plan.md`
- [ ] Voiceover narration generated via `uvx edge-tts`
- [ ] Sound design & music bed synthesized/rendered
- [ ] 600 high-resolution frames (1920×1080 @ 30fps) rendered via Chromium headless
- [ ] Visual QA on scene stills and mid-transitions
- [ ] Frame 0 poster extracted to `brag.jpg`
- [ ] Final video multiplexed and encoded to `brag.mp4`
- [ ] Postable share copy generated to `share-copy.txt`
