import { apiRequest } from '../../lib/api/client';
import type { User } from '../../lib/api/types';
import type { ApiContext } from '../workspace/api';

export interface AccountSetupInput {
  display_name: string;
  theme?: User['theme'];
  timezone?: string;
  week_start?: User['week_start'];
  date_format?: User['date_format'];
}

export function updateAccountSetup(
  context: ApiContext,
  input: AccountSetupInput,
) {
  return apiRequest<User>(context.serverUrl, '/api/account/setup', {
    method: 'PATCH',
    token: context.token,
    body: JSON.stringify(input),
  });
}

export function completeAccountSetup(context: ApiContext) {
  return apiRequest<User>(context.serverUrl, '/api/account/setup/complete', {
    method: 'POST',
    token: context.token,
  });
}
