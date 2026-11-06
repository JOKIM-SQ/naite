# Folio · 폴리오

S13 제품 매뉴얼 Q&A. 매뉴얼을 넣고 질문하면 관련 내용을 찾아 출처 문장과 함께 답한다. 문서에 근거가 없으면 모른다고 답한다.

공개 앱: **https://s13-folio.vercel.app/** · [기획서](https://s13-folio.vercel.app/docs/plan.html) · [스택 리포트](https://s13-folio.vercel.app/docs/report.html)

홈에는 2026 Tesla Model 3 Premium RWD · Stealth Grey를 표현한 생성 이미지와 FSD 주변 인식 화면에서 영감을 얻은 센서 스캔·차선 흐름·빛 입자 효과를 적용했다. 움직임 줄이기 설정에서는 애니메이션을 멈춘다. 생성 정보는 [ASSETS.md](ASSETS.md)에 기록했다.

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

새 DB에는 `supabase/001_manual_rag.sql` 다음 `supabase/002_preloaded_manuals.sql` 순서로 적용한다. 001을 적용한 기존 DB에는 002를 추가 적용한다. 002는 공용 사전 등록 자료의 상태·출처·진행률과 검색 권한을 지원한다. 기존 S13 테이블은 재사용하고 다른 주차 데이터는 변경하지 않는다. 관리 권한이 없으면 사용자가 SQL Editor에서 실행한다. API 키 입력만으로 테이블이 자동 생성되지는 않는다. 현재 환경은 002 사용자 적용 후 REST 확인과 전체 1,904개 청크 exact count·ready 확인까지 마쳤다.

로컬 개발 서버는 `07/.env.local`과 `11/.env.ai.local`에서 위에 명시된 서버 키 및 `ANTHROPIC_MODEL`만 재사용한다. S13의 `.env.local`에 입력한 값이 우선한다. 이 재사용은 로컬 실행 전용이며 Vercel에서는 서버 환경변수를 따로 설정한다.

## 사용 흐름

1. 준비 완료된 '미리 등록된 매뉴얼'의 Tesla Model 3 사용 설명서를 선택한다. 기본 자료는 준비되면 자동 선택한다.
2. 자신의 문서는 '내 매뉴얼'에서 TXT/Markdown 파일로 업로드하고 인덱싱 후 선택한다.
3. 답변과 출처 문장을 함께 확인하고 원문과 대조한다.
4. 문서에 없는 질문도 던져 모른다는 응답을 확인한다.

### 답을 찾는 과정

질문하면 ‘답을 찾는 과정’에서 실제 서버 처리 단계가 갱신된다. 단계 버튼을 눌러 질문의 임베딩, 문단 검색, 답변의 근거 확인을 살펴볼 수 있다. 영문 매뉴얼의 한국어 질문은 검색용 영어 질문도 함께 보여준다.

벡터 그림은 실제 512차원 질문 벡터 중 일부 좌표를 나타낸다. 문단 카드에는 pgvector가 반환한 실제 코사인 유사도와 원문을 보여주며, 유사도는 정답 확률이 아니다. 검색한 문단과 최종 답변에 인용된 문단을 구분한다. 답변의 ‘과정 보기’로 해당 질문의 기록을 다시 확인할 수 있다. 과정을 살펴보는 동작은 임베딩이나 답변 API를 다시 호출하지 않는다.

브라우저는 `stream:true` 질문 요청의 NDJSON 진행 이벤트와 최종 결과를 읽는다. 서버는 실제 처리 단계 진입 시에만 이벤트를 보내며, 시간에 따른 가짜 진행률을 사용하지 않는다. 기존 JSON 질문 요청도 유지한다. 원본 매뉴얼 전체, 전체 벡터, 서버 키나 소유자 정보는 이 시각화에 보내지 않는다.

기본 자료 **Tesla Model 3 사용 설명서**는 사용자 제공 Model 3(2024+) North America·Software 2026.38.3 PDF 전체 329쪽의 영문 추출 텍스트다. 서버에서 한 번 사전 임베딩해 공유하며, 새 브라우저에서 문서 임베딩을 반복하지 않는다. 원본 PDF 파일 자체는 공개하지 않고 텍스트와 원문 쪽수로 근거를 확인한다. 그림·도표 이미지 OCR은 지원하지 않아 추출되지 않은 시각 자료에는 답할 수 없다. 지역·차량·버전에 따라 내용이 다를 수 있으므로 실제 운전에는 자신의 차량에 표시되는 최신 공식 지침이 우선한다.

이미 등록한 이전 요약이나 FSD 6쪽 자료는 '내 매뉴얼'에 그대로 남는다. 공용 기본 자료와 동일한 문서로 간주하지 않는다. 기본 자료는 서버 사전 등록이 끝나 ready가 되어야 조회할 수 있다. 기존 개인 문서를 삭제하거나 공용 자료로 바꾸지 않는다.

개인 업로드 문서는 30~40,000자, 이름은 120자, 질문은 500자까지 받는다. 요청 본문 한도는 180KB이며 브라우저 작업 공간당 개인 문서 최대 10개다. 공용 자료는 서버 사전 등록 전용 경로로 넣으며 브라우저 업로드 한도를 늘려 우회하지 않는다. DB 공용 자료 상한은 200만 자다. 청킹은 600자·80자 겹침, voyage-4-lite 512차원, pgvector 코사인 유사도 0.35 이상 상위 4개다. 전체 자료 준비 후 실제 질문으로 다시 평가한다. 기본 Claude 모델은 `claude-haiku-4-5-20251001`이며 서버의 `ANTHROPIC_MODEL`로 바꿀 수 있다.

## 전체 매뉴얼 사전 등록

002 SQL 적용 후 관리자가 `13/`에서 실행한다. PDF 추출에는 `pdftotext`가 필요하다. 실행은 Voyage API를 사용하므로 사용량과 요청 제한이 적용된다. 원본 PDF를 public 폴더에 복사하지 않는다.

```sh
node scripts/preload-manual.mjs --source /Users/johnkim/Downloads/Owners_Manual.pdf --batch-size 48 --delay-ms 61000 --embed-only
node scripts/preload-manual.mjs --source /Users/johnkim/Downloads/Owners_Manual.pdf --sync-only
```

기본 체크포인트는 `.qa/preload-tesla/`에 저장한다. 원문·모델·차원·청킹 설정이 같으면 같은 명령으로 임베딩 배치를 이어가며, `--sync-only`는 완료된 캐시를 DB에 동기화한다. `--cache-dir`로 캐시 위치를 바꿀 수 있다. 토큰·속도 제한이나 DB 동기화 실패 시 체크포인트를 보존한다. 저장 청크 수 검증 후에만 ready로 전환하므로 일부 배치가 끝났다는 사실을 전체 준비 완료로 보지 않는다. 고정 공용 문서 ID는 `d4d69ce1-13a0-4b3a-9e32-202638030329`다.

[Voyage AI 공식 가격](https://docs.voyageai.com/docs/pricing)의 voyage-4-lite는 계정 첫 2억 토큰 무료, 이후 100만 토큰당 $0.02다(2026-11-05 확인). 무료 잔여량은 실측하지 않았고 Claude 사용료는 별도다.

## 검증

2026-11-05(PST) Vercel production에서 실제 외부 API를 사용한 3+1 질문이 모두 첫 시도에 통과했다. 전화기 질문 3,463ms(p.106/PDF108), 타이어 라벨 3,262ms(p.204/PDF206), FSD 해제 3,819ms(p.105/PDF107)는 원문을 인용했고, 한국 무감독 FSD 출시일 2,986ms는 근거 부족·인용 0개로 답했다. 모든 질문에서 embedding → search → answer → verify → result 이벤트를 실제 수신했다. 원시 기록은 `13/.qa/production-live-rag.json`이다.

익명 브라우저에서 홈·기획서·리포트·차량 이미지의 HTTP 200을 확인했다. `.env.local`, `.qa/tesla-all-flow.txt`, `Owners_Manual.pdf`는 HTTP 404이며 서버 키·원본 PDF·로컬 캐시는 배포에서 제외했다. 모바일 390px에서 이미지 표시와 가로 넘침 없음도 확인했다. 현재 typecheck·lint·전체 56개 테스트·build가 통과했다. 셋업·배포 소요 시간과 첫 로딩 시간은 측정 기록이 없다.

### 이전 로컬 전체 자료 검증 이력

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

002 SQL을 적용하고 전체 329쪽을 정규화한 937,449자·1,904개 청크의 실제 Voyage 임베딩과 DB 저장을 마쳤다. DB exact count 1,904와 ready 상태를 확인했고, 서로 다른 두 세션에서 같은 공용 매뉴얼 메타데이터를 조회하며 개인 소유 정보가 노출되지 않는 것을 확인했다. 사용자 전화기 질문은 원문 p.106(PDF108) 기기 사용 금지를 인용해 3.7초에 답했다. 타이어 라벨 질문은 FSD 장 밖인 p.204(PDF206) 근거로 3.9초에 답했고, FSD 해제는 p.105(PDF107) 근거로 4.3초에 답했다. 이는 실제 UI 응답 표시값이다. 원시 결과는 `13/.qa/preloaded-live-rag.json`이다.

없는 한국 무감독 FSD 출시일 질문은 검색용 영어 번역의 출력 제한으로 JSON이 잘려 첫 시도가 실패했다. 번역 출력 한도를 200에서 1,024로 늘리고 JSON 코드 블록 처리도 보완한 뒤, 새 서버·새 검증 세션에서 재시도해 근거 부족·인용 0개·3.2초의 모른다는 응답을 확인했다. 이 결과는 `13/.qa/preloaded-live-unknown.json`에 별도 보존했다. 따라서 최종 3+1은 통과했지만 최초 시도 전체 성공은 아니다. 기존 전화기 질문 실패 원인은 요약의 원문 누락이었고 임계값이나 모델 지식으로 우회하지 않고 전체 원문으로 해결했다.

이전 Tesla 요약본은 실제 Markdown 3,689자·7개 청크에서 감독·해제·날씨 질문과 없는 한국 무감독 출시일 질문만 검증했다. 응답 표시는 2.6초·3.3초·5.0초·1.5초이며 원시 이력은 `13/.qa/tesla-live-rag.json`이다. 이 네 질문의 성공과 출처 모달 확인은 보존하되 새 원문 포함판 또는 모든 질문의 성공으로 해석하지 않는다. 상세 기록은 [SPIKE.md](SPIKE.md)와 [SUBMISSION.md](SUBMISSION.md)에 있다.

이전 MORI Air Mini 샘플의 1문서·2개 청크 및3+1 질의 결과는 별도 이력 `13/.qa/live-rag.json`에 보존했다. 해당 시연은 세 번째 질문에서 HTTP429 후 약1분 뒤 UI 재시도로 성공했으며 Tesla 결과와 구분한다. 검색 과정 인터랙션 추가 후 현재 코드의 전체56개 테스트와 build·lint·typecheck가 통과했다. 새로고침 후 기본Tesla 자동 선택, 390px 가로 넘침 없음과 콘솔 오류0을 확인했다.

새 환경에서는 키와 DB 스키마를 먼저 준비해야 하며 누락 설정은 화면에서 안내한다. Voyage 무료 토큰과 속도 제한은 별개다. 이번 계정은 3 RPM·10,000 TPM을 확인하여 48개 배치·61초 간격으로 적재를 완료했다. 로컬 토크나이저의 전체 추정은 222,207토큰이고 API 응답에서 기록한 실제 토큰 합계는 214,307이다. 첫 64개 청크의 API 사용량이 기록되지 않아 둘을 같은 실측 수치로 보지 않는다. 계정 무료 잔여량은 확인하지 않았다. 위 로컬 이력 이후 공개 production 검증도 완료했다.

Tesla 공식 웹 URL의 HTTP 403 이후 사용자가 실제 PDF를 제공하여 원문을 확보했다. 기본 자료는 PDF 전체 329쪽의 영문 텍스트 추출본이며 원본 PDF 파일은 로컬 입력 자료로만 둔다. 정확한 한국 무감독 FSD 출시일처럼 원문에 없는 내용이나 OCR하지 않은 그림 내용은 추측하지 않는다.

## initialB 제출

- 소개 및 앱: `/`
- 팀 템플릿 기획서: `/docs/plan.html`
- 팀 템플릿 스택 리포트: `/docs/report.html`
- 등록용 정보: [INITIALB.md](INITIALB.md)
- 제출 체크리스트: [SUBMISSION.md](SUBMISSION.md)

공개 배포와 두 문서의 익명 접근, report.html의 실제 URL 반영을 완료해 제출 준비가 끝났다. 사용자는 initialB에 **https://s13-folio.vercel.app/** 하나를 등록하면 된다. initialB 실제 등록은 아직 하지 않았다. 보고서의 복사 버튼은 레지스트리 7열·비교표 11열 TSV를 만든다.

Vercel 프로젝트의 Root Directory는 `13`이며 production 서버 환경변수 5개를 설정했다. 값은 공개 문서와 브라우저에 노출하지 않는다. SQL 준비·전체 자료 적재·실제 production 3+1 시연을 각각 확인했다.
