/** 브라우저 다운로드를 시작한다. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** CSV 문자열 다운로드 (Excel에서 한글이 깨지지 않도록 UTF-8 BOM 포함). */
export function downloadCsv(filename: string, text: string): void {
  downloadBlob(filename, new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
}
