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

MORI Air Mini 공기청정기는 **시연용 가상 제품**이다. 포함된 매뉴얼은 실제 제조사 문서나 실제 제품 안전 지침이 아니다. 단위 테스트의 예시 응답은 실제 API 검증 결과와 구분한다.

문서는 30~40,000자, 이름은 120자, 질문은 500자까지 받는다. 요청 본문 한도는 180KB이며 브라우저 작업 공간당 최대 10개 문서를 준비한다. 청킹은 600자·80자 겹침이다. voyage-4-lite 512차원 임베딩으로 pgvector 코사인 유사도 0.35 이상의 상위 4개를 검색한다. 이 수치는 샘플의 3+1 질문으로 확인했으며 다양한 문서에서 최적화한 결과는 아니다. 기본 Claude 모델은 `claude-haiku-4-5-20251001`이며 서버의 `ANTHROPIC_MODEL`로 바꿀 수 있다.

[Voyage AI 공식 가격](https://docs.voyageai.com/docs/pricing)의 voyage-4-lite는 계정 첫 2억 토큰 무료, 이후 100만 토큰당 $0.02다(2026-11-05 확인). 무료 잔여량은 실측하지 않았고 Claude 사용료는 별도다.

## 검증

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

현재 로컬에서는 키 설정과 사용자 SQL 적용을 마친 뒤 실제 Voyage·Supabase·Claude 경로를 검증했다. MORI Air Mini 1문서를 2개 청크로 인덱싱하고(저장된 GET 메타데이터 기준), 있는 질문 3개는 출처와 함께 답하며 없는 Wi-Fi 질문 1개는 모른다고 답했다. 세 번째 질문은 최초 HTTP 429 후 약 1분 뒤 UI 재시도로 성공했다. 응답 표시는 3.6초·2.3초·2.5초·1.0초이며 대기시간을 포함한 전체 소요 시간이 아니다. 실제 증거는 `13/.qa/live-rag.json`, 상세 기록은 [SPIKE.md](SPIKE.md)와 [SUBMISSION.md](SUBMISSION.md)에 있다.

새 환경에서는 키와 DB 스키마를 먼저 준비해야 하며, 누락 설정은 화면에서 안내한다. Voyage의 무료 토큰과 요청 속도 제한은 별개다. HTTP 429이면 안내에 따라 잠시 후 재시도한다. 계정별 RPM·무료 잔여량은 측정하지 않았다. 실제 파일 선택 업로드와 공개 배포는 아직 검증하지 않았다.

Tesla FSD 매뉴얼 샘플 요청은 공식 URL의 HTTP 403으로 원문 확보를 기다리는 중이다. 공식 PDF 또는 본문이 준비되기 전에는 가상 MORI 샘플을 유지하며 Tesla 사양을 생성해 채우지 않는다.

## initialB 제출

- 소개 및 앱: `/`
- 팀 템플릿 기획서: `/docs/plan.html`
- 팀 템플릿 스택 리포트: `/docs/report.html`
- 등록용 정보: [INITIALB.md](INITIALB.md)
- 제출 체크리스트: [SUBMISSION.md](SUBMISSION.md)

현재 공개 URL은 기록 없음이다. 배포 후 사이트와 두 문서의 공개 접근을 확인하고, report.html의 `data-f="url"`에 실제 URL을 반영한다. 이 확인이 끝난 뒤 initialB에는 사이트 루트 URL 하나를 등록한다. 보고서의 복사 버튼은 레지스트리 7열·비교표 11열 TSV를 만든다. 현재의 빈 URL로 제출하지 않는다.

Vercel 프로젝트의 Root Directory는 `13`으로 지정한다. 필수 환경변수는 Vercel 서버 환경변수에도 설정한다. SQL 준비와 실제 3+1 시연은 공개 배포 여부와 별도로 확인해야 한다.
