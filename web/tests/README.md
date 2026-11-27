# 자동 시험

폰 크기(Pixel 7) 브라우저에서 앱을 실제로 눌러 보는 시험입니다(Playwright).
`fx/`는 시험용 문서(모두 직접 만든 가짜 내용), 결과 화면·저장 파일은 `out/`에 생깁니다.

```bash
cd web && npm run build
npx vite preview --outDir ../android/app/src/main/assets/www --port 4173 --strictPort &
mkdir -p tests/out
node tests/t2.cjs tests      # 형식별 열기·수정·저장, 새 문서, 뒤로가기 종료 확인
```

| 파일 | 시험 내용 |
|---|---|
| t2.cjs | 워드·엑셀·슬라이드·PDF·한글·메모 열기→수정→저장, 새 문서 5종, 홈에서 뒤로가기 종료 창 |
| t3.cjs | 임시저장: 강제 종료 후 자동 복원, 닫기 창(저장/임시저장/버리기), PDF 글 넣기 |
| t4.cjs | 기본 앱 설정 창(가짜 NativeBridge로 시험) |
| t5.cjs | 새 홈 화면, 탭, 은행 엑셀(HTML 표 XLS) 열기·저장 |
| t6.cjs | 표가 여러 개인 은행 엑셀을 한 시트로 보기·합친 칸 |
| t7.cjs | 글꼴: 고르기 창, 받기(인터넷 필요), 워드·한글·슬라이드·PDF 글꼴 적용·저장 |
| t8.cjs | HTML: 스크립트 차단, 외부 요청 없음, 링크, 편집·저장, EUC-KR |

저장된 파일 검증은 python-docx·openpyxl·python-pptx 또는 `@rhwp/core`로 다시 열어 확인했습니다.
