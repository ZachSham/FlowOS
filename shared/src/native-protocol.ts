import type { NativeEventName, NativeEventPayloadMap } from "./native-events.js";
import type { NativeMethod, NativeRequestPayloadMap, NativeResponsePayloadMap } from "./native-actions.js";

export interface NativeRequest<M extends NativeMethod = NativeMethod> {
  id: string;
  kind: "request";
  method: M;
  payload: NativeRequestPayloadMap[M];
}

export interface NativeErrorPayload {
  code: string;
  message: string;
}

export interface NativeSuccessResponse<M extends NativeMethod = NativeMethod> {
  id: string;
  kind: "response";
  method: M;
  ok: true;
  payload: NativeResponsePayloadMap[M];
}

export interface NativeErrorResponse<M extends NativeMethod = NativeMethod> {
  id: string;
  kind: "response";
  method: M;
  ok: false;
  error: NativeErrorPayload;
}

export interface NativeEventEnvelope<E extends NativeEventName = NativeEventName> {
  kind: "event";
  event: E;
  payload: NativeEventPayloadMap[E];
}

export type NativeResponse<M extends NativeMethod = NativeMethod> =
  | NativeSuccessResponse<M>
  | NativeErrorResponse<M>;

export type NativeMessage = NativeRequest | NativeResponse | NativeEventEnvelope;

