// 키워드 보강 CLI 공급자 공통 인터페이스
export interface Provider {
  /** 실행할 커맨드. 프롬프트는 stdin으로 전달된다 (Windows cmd 인용 문제 회피).
   *  outFile: 최종 메시지 회수용 임시 파일 경로 — output이 "file"인 공급자만 사용 */
  argv(model: string, outFile: string): string[];
  /** 최종 메시지 위치 — "stdout": 표준 출력 마지막 줄, "file": outFile */
  output: "stdout" | "file";
}
