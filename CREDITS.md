# Credits & Licenses

## 함께 배포되는 것 (vendor/, assets/)
| 항목 | 출처 | 라이선스 |
|---|---|---|
| three.js r160 | https://github.com/mrdoob/three.js | MIT |
| MediaPipe Tasks Vision (wasm, bundle) | https://github.com/google-ai-edge/mediapipe | Apache-2.0 |
| hand_landmarker.task, blaze_face_short_range.tflite | Google MediaPipe models (storage.googleapis.com/mediapipe-models) | Apache-2.0 |
| Gaegu (Regular/Bold) | https://github.com/google/fonts/tree/main/ofl/gaegu | SIL OFL 1.1 — `assets/fonts/OFL-gaegu.txt` |
| Gowun Batang | https://github.com/google/fonts/tree/main/ofl/gowunbatang | SIL OFL 1.1 — `assets/fonts/OFL-gowunbatang.txt` |

사운드는 외부 음원 없이 전부 Web Audio로 합성합니다 (`hello/sound.js`, `audio.js`).

## 코드를 옮겨 온 것
- **sirxemic/jquery.ripples** (MIT) — 파동 방정식 drop/update 셰이더 구조 → `hello/water.js`

## 아이디어만 참고한 것 (코드 복사 없음)
- **inkle/ink**, **y-lohse/inkjs** (MIT) — 비트 + 조건 분기 대화 구조 → `hello/director.js`
- **torinmb/mediapipe-touchdesigner** (MIT) — TouchDesigner에서 손 핀치 거리/회전을 다루는 방식
- **collidingScopes/threejs-handtracking-101**, **collidingScopes/arpeggiator**, **collidingScopes/iron-interface** — 라이선스 표기 없음 → 참고만 함
- **damiansire/web-ar-hand-tracking** (MIT), **FollowTheDarkside/threejs-webcam-particle-visualizer**
