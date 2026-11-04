const advice: Record<string, string> = {
  EAUTH: '帳密驗證失敗。請檢查 email.user 與 email.password；Gmail 請使用應用程式密碼。',
  EENVELOPE: '寄件者或收件者被拒絕。請檢查 email.from、email.to 與 SMTP 寄送權限。',
  EMESSAGE: 'SMTP 拒絕郵件內容。請確認寄件服務的寄送限制。',
  EDNS: 'SMTP 主機解析失敗。請檢查 email.host 與 DNS 連線。',
  ENOTFOUND: '找不到 SMTP 主機。請檢查 email.host 的拼字。',
  EAI_AGAIN: 'DNS 暫時無法解析 SMTP 主機。請檢查網路後再試。',
  ETIMEDOUT: 'SMTP 連線逾時。請檢查網路、email.host 與 email.port。',
  ECONNREFUSED: 'SMTP 連線被拒絕。請檢查 email.host、email.port 與防火牆。',
  ECONNRESET: 'SMTP 伺服器中斷連線。請檢查網路與 TLS 設定。',
  ECONNECTION: 'SMTP 連線失敗。請檢查 email.host、email.port 與網路。',
  ESOCKET: 'SMTP 連線或 TLS 驗證失敗。請檢查 email.host、email.port 與 email.secure。',
  ETLS: '無法啟用 TLS。請檢查 SMTP 主機與 email.secure 設定。',
  EPROTOCOL: 'SMTP 回覆不符合預期。請確認主機與連接埠提供 SMTP 服務。',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS 憑證名稱與 SMTP 主機不符。請檢查 email.host 的拼字。',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'SMTP 使用未受信任的自簽 TLS 憑證。請確認主機與憑證設定。',
  SELF_SIGNED_CERT_IN_CHAIN: 'SMTP 憑證鏈包含未受信任的自簽憑證。請檢查憑證設定。',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '無法驗證 SMTP 憑證鏈。請檢查主機與憑證設定。',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: '找不到 SMTP 憑證的受信任簽發者。請檢查憑證設定。',
  CERT_HAS_EXPIRED: 'SMTP TLS 憑證已過期。請確認系統時間與伺服器憑證。',
};

/** Display known codes and static guidance without exposing messages, credentials or SMTP responses. */
export function describeEmailError(error: unknown): string {
  if (error instanceof SyntaxError) {
    return '設定格式錯誤。請檢查 config.json 的 JSON 格式與設定中的正規表示式。';
  }

  const fields =
    error && typeof error === 'object'
      ? (error as { code?: unknown; originalCode?: unknown; responseCode?: unknown })
      : {};
  const knownCode = (value: unknown): string | undefined =>
    typeof value === 'string' && Object.hasOwn(advice, value) ? value : undefined;
  const code = knownCode(fields.code);
  const original = knownCode(fields.originalCode);
  const reason = original ?? code;

  if (reason) {
    const codes = [...new Set([code, original].filter(Boolean))].join(' / ');
    const response =
      typeof fields.responseCode === 'number' &&
      Number.isInteger(fields.responseCode) &&
      fields.responseCode >= 400 &&
      fields.responseCode <= 599
        ? `，SMTP ${fields.responseCode}`
        : '';

    return `${codes}${response}：${advice[reason]}`;
  }

  const message = error instanceof Error ? error.message : '';

  if (message === '不接受額外參數') {
    return message;
  }

  if (message === '請先在 config.json 設定 email.enabled=true') {
    return message;
  }

  const configFields = [
    ...new Set(
      message.match(/\bemail\.(?:enabled|host|port|secure|user|password|from|to|timeoutMs)\b/g),
    ),
  ];

  if (configFields.length) {
    return `設定驗證失敗。請檢查 ${configFields.join('、')}。`;
  }

  return '無法完成寄送。請檢查 config.json、SMTP 設定與網路；未顯示原始錯誤以避免洩漏密碼。';
}
