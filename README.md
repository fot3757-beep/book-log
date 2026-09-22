# My Book Log — 나만의 독서기록장 (Railway 배포용)

Node.js(Express) + SQLite로 동작하는 독서기록 웹앱입니다.
카테고리 생성, 별점, 날짜, 표지 사진, 그리고 Quill 기반 블로그 스타일 에디터로 긴 기록을 남길 수 있어요.

## 로컬에서 실행해보기

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 접속.

## 환경변수

| 변수 | 설명 | 기본값 |
|---|---|---|
| `PORT` | 서버 포트 (Railway가 자동으로 넣어줌) | 3000 |
| `DB_PATH` | SQLite 파일 경로 | `./data/app.db` |
| `UPLOAD_DIR` | 업로드 이미지 저장 폴더 | `./public/uploads` |
| `ACCESS_PASSWORD` | 설정하면 접속 시 비밀번호(Basic Auth) 요구 | (없음, 비활성) |
| `ACCESS_USER` | 위 비밀번호와 함께 쓰는 아이디 | `admin` |

Railway에 배포할 때는 **Volume을 추가**하고 `DB_PATH`, `UPLOAD_DIR`을 그 볼륨 경로 아래로 지정해야
재배포/재시작해도 기록과 사진이 사라지지 않습니다. (자세한 방법은 대화 내 배포 가이드 참고)
