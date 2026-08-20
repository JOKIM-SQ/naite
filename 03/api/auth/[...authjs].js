export const config = { runtime: 'edge' };

import { Auth, skipCSRFCheck } from '@auth/core';
import { authConfig } from '../../lib/auth-config.js';

// SPA에서 fetch로 직접 호출하므로 별도 CSRF 토큰 왕복 없이 처리한다.
authConfig.skipCSRFCheck = skipCSRFCheck;

export default async function handler(request) {
  return Auth(request, authConfig);
}
