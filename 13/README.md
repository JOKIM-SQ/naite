# Folio · 폴리오

S13 제품 매뉴얼 Q&A. 매뉴얼을 넣고 질문하면 관련 내용을 찾아 출처 문장과 함께 답한다. 문서에 근거가 없으면 모른다고 답한다.

## 구성

- 화면: 정적 HTML/CSS/JavaScript
- 서버: Node API, 로컬 개발 서버 / Vercel 서버리스 배포 구성
- 검색: Voyage AI 임베딩 + Supabase Postgres의 pgvector
- 답변: Claude

검색과 답변 생성은 서버에서 실행한다. API 키를 브라우저 코드에 넣지 않는다. 별도의 로그인, PDF OCR, 웹 검색은 구현 범위에 없다.

## 로컬 실행

Node 22.12 이상을 사용한다. 이 저장소의 `13/`에서 실행한다.

```sh
npm install
npm run dev
```

기본 개발 주소: http://127.0.0.1:3130/

환경변수 예시는 `.env.example`을 참고해 **`/Users/johnkim/workspace/naite/13/.env.local`**에 저장한다. 키를 채팅이나 커밋에 붙여 넣지 않는다.

필수 서버 환경변수:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VOYAGE_API_KEY`
- `ANTHROPIC_API_KEY`

DB에는 `supabase/001_manual_rag.sql`을 적용해야 한다. 기존 데이터는 변경하지 않고 S13 테이블·검색 함수만 준비한다. 기존 Supabase 프로젝트의 관리 권한이 없으면 사용자가 SQL Editor에서 실행한다. API 키 입력만으로 테이블이 자동 생성된다고 가정하지 않는다.

로컬 개발 서버는 `07/.env.local`과 `11/.env.ai.local`에서 위에 명시된 서버 키 및 `ANTHROPIC_MODEL`만 재사용한다. S13의 `.env.local`에 입력한 값이 우선한다. 이 재사용은 로컬 실행 전용이며 Vercel에서는 서버 환경변수를 따로 설정한다.

## 사용 흐름

1. 샘플 매뉴얼을 선택하거나 자신의 TXT/Markdown 파일을 업로드한다.
2. 인덱싱이 완료되면 자연어로 질문한다.
3. 답변과 출처 문장을 함께 확인하고 원문과 대조한다.
4. 문서에 없는 질문도 던져 모른다는 응답을 확인한다.

기본 샘플은 **Tesla Model 3(2024+)의 FSD (Supervised) 매뉴얼 발췌·요약**이다. 사용자가 제공한 North America·Software 2026.38.3 원본의 인쇄 102~107쪽(PDF 104~109쪽)을 바탕으로 한국어 요약과 영문 발췌를 비공식 편집했다. 원본 PDF 전체를 공개하지 않는다. 제품·지역·버전에 따라 내용이 다를 수 있으므로 실제 운전에는 자신의 차량에 표시되는 최신 공식 지침이 우선한다. 단위 테스트 예시, 과거 샘플 결과, 현재 Tesla 실검증을 구분한다.

문서는 30~40,000자, 이름은 120자, 질문은 500자까지 받는다. 요청 본문 한도는 180KB이며 브라우저 작업 공간당 최대 10개 문서를 준비한다. 청킹은 600자·80자 겹침이다. voyage-4-lite 512차원 임베딩으로 pgvector 코사인 유사도 0.35 이상의 상위 4개를 검색한다. 이 수치는 샘플의 3+1 질문으로 확인했으며 다양한 문서에서 최적화한 결과는 아니다. 기본 Claude 모델은 `claude-haiku-4-5-20251001`이며 서버의 `ANTHROPIC_MODEL`로 바꿀 수 있다.

[Voyage AI 공식 가격](https://docs.voyageai.com/docs/pricing)의 voyage-4-lite는 계정 첫 2억 토큰 무료, 이후 100만 토큰당 $0.02다(2026-11-05 확인). 무료 잔여량은 실측하지 않았고 Claude 사용료는 별도다.

## 검증

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

키 설정과 사용자 SQL 적용을 마쳤다. 주력 Tesla 샘플의 실제 Markdown 파일 3,689자를 업로드해 Voyage 임베딩과 pgvector 7개 청크 저장을 확인했다. 감독 의무·해제 방법·비/눈/안개 질문은 각각 원문 쪽수를 표시한 인용과 함께 답했고, 한국 무감독 FSD 정확한 출시일은 문서만으로 알 수 없다고 답했다. 응답 표시는 2.6초·3.3초·5.0초·1.5초다. 요청 간 간격을 둔 이번 네 질문은 모두 첫 시도 성공했으며, 항상 속도 제한 없이 성공한다는 의미는 아니다. 원시 결과는 `13/.qa/tesla-live-rag.json`, 상세 내용은 [SPIKE.md](SPIKE.md)와 [SUBMISSION.md](SUBMISSION.md)에 있다. 출처 모달의 원문 쪽수와 비공식 편집 고지도 실제 클릭으로 확인했다.

이전 MORI Air Mini 샘플의 1문서·2개 청크 및 3+1 질의 결과는 별도 이력 `13/.qa/live-rag.json`에 보존했다. 해당 시연은 세 번째 질문에서 HTTP 429 후 약 1분 뒤 UI 재시도로 성공했으며 Tesla 결과와 구분한다. 최종 build(typecheck·lint·전체 테스트)는 17개 테스트를 포함해 통과했다.

새 환경에서는 키와 DB 스키마를 먼저 준비해야 하며, 누락 설정은 화면에서 안내한다. Voyage의 무료 토큰과 요청 속도 제한은 별개다. HTTP 429이면 안내에 따라 잠시 후 재시도한다. 계정별 RPM·무료 잔여량은 측정하지 않았다. 공개 배포는 아직 검증하지 않았다.

Tesla 공식 웹 URL의 HTTP 403 이후 사용자가 실제 PDF를 제공하여 원문을 확보했다. 원본은 로컬 입력 자료이며 전체 공개 배포 대상이 아니다. 기본 샘플은 해당 원문의 제한된 부분을 출처와 함께 편집한 자료를 사용하며, 정확한 한국 무감독 FSD 출시일처럼 원문에 없는 내용은 알 수 없다고 답해야 한다.

## initialB 제출

- 소개 및 앱: `/`
- 팀 템플릿 기획서: `/docs/plan.html`
- 팀 템플릿 스택 리포트: `/docs/report.html`
- 등록용 정보: [INITIALB.md](INITIALB.md)
- 제출 체크리스트: [SUBMISSION.md](SUBMISSION.md)

현재 공개 URL은 기록 없음이다. 배포 후 사이트와 두 문서의 공개 접근을 확인하고, report.html의 `data-f="url"`에 실제 URL을 반영한다. 이 확인이 끝난 뒤 initialB에는 사이트 루트 URL 하나를 등록한다. 보고서의 복사 버튼은 레지스트리 7열·비교표 11열 TSV를 만든다. 현재의 빈 URL로 제출하지 않는다.

Vercel 프로젝트의 Root Directory는 `13`으로 지정한다. 필수 환경변수는 Vercel 서버 환경변수에도 설정한다. SQL 준비와 실제 3+1 시연은 공개 배포 여부와 별도로 확인해야 한다.
