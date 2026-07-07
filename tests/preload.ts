// bun test preload (bunfig.toml) — 모든 테스트 파일에 결정적으로 적용
// 통합 테스트가 서버를 스폰할 때마다 터미널 창이 뜨지 않도록 창 없는 detached 스폰을 강제
process.env.NUNCHI_NO_WINDOW = "1";
