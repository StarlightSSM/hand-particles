# Credits & Licenses

## 함께 배포되는 것 (vendor/, assets/)
| 항목 | 출처 | 라이선스 |
|---|---|---|
| three.js r160 | https://github.com/mrdoob/three.js | MIT |
| MediaPipe Tasks Vision (wasm, bundle) | https://github.com/google-ai-edge/mediapipe | Apache-2.0 |
| hand_landmarker.task, face_landmarker.task (얼굴 478점 + 표정 블렌드셰이프 52개) | Google MediaPipe models (storage.googleapis.com/mediapipe-models) | Apache-2.0 |
| @vladmandic/face-api 1.7.15 (+ 번들된 TensorFlow.js) | https://github.com/vladmandic/face-api | MIT — `vendor/face-api/LICENSE` |
| tiny_face_detector, face_landmark_68, face_recognition 모델 | face-api.js 모델 (face_recognition은 dlib ResNet 기반) | MIT (face-api.js) |
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

## 표정 읽기 카탈로그의 근거 (hello/expression.js)
코드에 옮긴 것은 아래 문헌의 'AU 조합 ↔ 표정' 대응이며, 문헌의 데이터·도표를 복사하지는 않았습니다.
- Ekman, P. & Friesen, W. V. (1978). *Facial Action Coding System*. / Ekman, Friesen & Hager (2002) 개정판
- Matsumoto, D. & Ekman, P. (2008). Facial expression analysis. *Scholarpedia* 3(5):4237. doi:10.4249/scholarpedia.4237
- Lucey, P. et al. (2010). The Extended Cohn-Kanade Dataset (CK+). CVPR Workshops — 감정별 필수 AU 규칙 (Table 2)
- Ekman, Davidson & Friesen (1990). The Duchenne smile. *JPSP* 58(2):342–353. doi:10.1037/0022-3514.58.2.342
- Krumhuber & Manstead (2009). Can Duchenne smiles be feigned? *Emotion* 9(6):807–820. doi:10.1037/a0017844
- McDaniel, D'Mello et al. (2007). Facial features for affective state detection in learning environments. CogSci
- Grafsgaard et al. (2013). Automatically recognizing facial indicators of frustration. ACII. doi:10.1109/ACII.2013.33
- el Kaliouby, R. & Robinson, P. (2004). Real-time inference of complex mental states from facial expressions and head gestures. CVPR Workshop
- Aldenhoven et al. (2026). Real-time emotion recognition performance of mobile devices. *Sensors* 26(3):1060. doi:10.3390/s26031060 (CC BY 4.0) — 블렌드셰이프 ↔ AU 대응
- M. Ozel, "ARKit to FACS Cheat Sheet" — https://melindaozel.com/arkit-to-facs-cheat-sheet/
- **주의점**: Barrett, Adolphs, Marsella, Martinez & Pollak (2019). Emotional expressions reconsidered. *PSPI* 20(1):1–68. doi:10.1177/1529100619832930 — 표정은 감정의 확실한 지문이 아니므로, 아이는 단정하지 않고 본 것을 말하고 물어봅니다.

## 구조를 참고한 것
- **damiansire/web-ar-hand-tracking** (MIT) — MediaPipe를 Web Worker에서 돌리는 구조 → `hello/vision.worker.js`
