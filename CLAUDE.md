# 문서 편집기 — 작업 노트

안드로이드용 모바일 문서 편집기(APK). 참고 사이트: https://hwp-mobile-editor.pages.dev/

## 사용자와 정한 작업 방식
- 사용자에게는 한국어로 답한다(개인 CLAUDE.md 규칙). 뒤로가기·종료 확인 규칙도 개인 규칙을 따른다.
- **완성된 APK 파일은 내가 직접 첨부해서 보낸다**(사용자가 따로 받지 않게). 버전 올릴 때마다 `dist/DocumentEditor-<버전>.apk`로 만들어 첨부.
- "출시" = 설치용 APK를 만들어 주는 것. 플레이스토어 등록은 하지 않았다.
- 임시저장(앱이 종료돼도 남기)이 가장 중요한 기능이라고 했다. 건드릴 때 꼭 다시 시험한다.
- 디자인 시안: `docs/design/home-mockup.png`, 앱 아이콘 원본: `docs/design/app-icon.png`.
  시안의 "프리미엄" 탭은 유료 기능이 없어 "설정" 탭으로 바꿨다(사용자에게 알림, 원하면 바꿀 수 있음).

## 구조
- `web/` 편집기 화면(Vite, 순수 JS). `src/formats/*.js`가 형식별 열기·편집·저장.
  - docx(docx-preview + 원본 XML 부분 수정), xlsx(SheetJS, XLSX는 고친 칸만 반영, HTML 표 엑셀 지원),
    pptx(@aiden0z/pptx-renderer + XML 수정), pdf(pdf.js + pdf-lib), hwp(@rhwp/core WASM),
    html(sandbox iframe, 스크립트 실행·외부 요청 차단, 저장 시 원본 복원), text, legacy(DOC·PPT 글만)
  - `drafts.js` 임시저장(IndexedDB), `fonts.js` 글꼴 고르기·받기, `native.js` 안드로이드 다리
- `android/` WebView 껍데기(`MainActivity.java`): 파일 열기/저장(SAF), 공유, 인쇄, 기본 앱 설정, 뒤로가기.
  화면 파일은 `https://docedit.app.local/`로 앱 안에서 제공.
- 서명 키: `android/keystore/sideload.jks` (비밀번호 android) — 같은 키여야 덮어 설치됨. 지우지 말 것.

## 빌드 환경 준비(새 세션/새 컨테이너에서)
```bash
# 1) 안드로이드 SDK
mkdir -p /opt/android-sdk/cmdline-tools && cd /opt/android-sdk/cmdline-tools
curl -sSLo ct.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q ct.zip && mv cmdline-tools latest && rm ct.zip
yes | latest/bin/sdkmanager --sdk_root=/opt/android-sdk "platforms;android-35" "build-tools;35.0.0" "platform-tools"
echo "sdk.dir=/opt/android-sdk" > <저장소>/android/local.properties
# 2) 웹 의존성과 글꼴(글꼴 woff2는 용량 때문에 git에 없음 → 스크립트로 다시 받는다)
pip install fonttools brotli
cd <저장소>/web && npm install && python3 scripts/build-fonts.py
# 3) 빌드
npm run build && cd ../android && gradle assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../dist/DocumentEditor-<버전>.apk
```
- 버전은 `android/app/build.gradle`(versionCode·versionName)과 `web/index.html`·`web/src/main.js`의 "문서 편집기 x.y" 문구를 함께 올린다.
- 자동 시험: `web/tests/README.md`.

## 버전 기록
- 1.0 첫 APK(형식별 열기·편집, 임시저장) · 1.1 기본 앱 설정 · 1.2 새 홈 디자인, 은행 HTML 엑셀
- 1.3 여러 표 엑셀 한 시트 표시 · 1.4 다른 앱에서 연 문서 닫으면 그 앱으로 복귀
- 1.5 한글 무료 글꼴(앱 61종 + 받기 139종), 문서별 글꼴·크기 · 1.6 HTML 열기·편집 (현재)

## 아직 안 된 것 / 확인 못 한 것
- 실제 폰에서의 확인은 사용자 몫: 파일 덮어쓰기, 공유, 인쇄, 기본 앱 설정 유지, 글꼴 받기, 다른 앱 복귀.
- HTML 문서 안 찾기 미지원, 인터넷 그림 "불러오기" 버튼 없음, 새 HTML 문서 만들기 없음.
- 엑셀 수식은 앱 안에서 재계산 안 함(엑셀에서 열 때 계산). PDF에 넣은 글은 그림으로 들어감.
- 앱 크기 약 72MB(대부분 글꼴).
