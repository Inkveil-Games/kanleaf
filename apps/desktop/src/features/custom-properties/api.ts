import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';
import type {
  CustomPropertyDefinition,
  CustomPropertyType,
  TaskCustomPropertyValue,
  UndefinedPropertySummary,
  UndefinedTaskProperty,
} from '../workspace/types';

export interface PropertyOptionCreateInput {
  name: string;
  color: string;
}

export interface PropertyOptionSaveInput extends PropertyOptionCreateInput {
  id?: string;
  archived?: boolean;
}

export interface PropertyCreateInput {
  name: string;
  type: CustomPropertyType;
  description: string;
  options?: PropertyOptionCreateInput[];
}

export function listProperties(context: ApiContext, workspaceId: string) {
  return apiRequest<CustomPropertyDefinition[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/properties`,
    { token: context.token },
  );
}

export function createProperty(
  context: ApiContext,
  workspaceId: string,
  input: PropertyCreateInput,
) {
  return apiRequest<CustomPropertyDefinition>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/properties`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify(input),
    },
  );
}

export function defineProperty(
  context: ApiContext,
  workspaceId: string,
  input: PropertyCreateInput,
) {
  return apiRequest<CustomPropertyDefinition>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/properties/define`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify(input),
    },
  );
}

export function updateProperty(
  context: ApiContext,
  workspaceId: string,
  propertyId: string,
  patch: {
    name?: string;
    description?: string;
    archived?: boolean;
    options?: PropertyOptionSaveInput[];
  },
) {
  return apiRequest<CustomPropertyDefinition>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/properties/${propertyId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
    },
  );
}

export function reorderProperties(
  context: ApiContext,
  workspaceId: string,
  ids: string[],
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/properties/reorder`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ ids }),
    },
  );
}

export function deleteProperty(
  context: ApiContext,
  workspaceId: string,
  propertyId: string,
  name: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/properties/${propertyId}`,
    {
      method: 'DELETE',
      token: context.token,
      body: JSON.stringify({ name }),
    },
  );
}

export function setTaskPropertyValue(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  propertyId: string,
  value: TaskCustomPropertyValue['value'],
) {
  return apiRequest<TaskCustomPropertyValue>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}/properties/${propertyId}`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ value }),
    },
  );
}

export function clearTaskPropertyValue(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  propertyId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}/properties/${propertyId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function listUndefinedProperties(
  context: ApiContext,
  workspaceId: string,
) {
  return apiRequest<UndefinedPropertySummary[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/properties/undefined`,
    { token: context.token },
  );
}

export function listTaskUndefinedProperties(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
) {
  return apiRequest<UndefinedTaskProperty[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}/properties/undefined`,
    { token: context.token },
  );
}
