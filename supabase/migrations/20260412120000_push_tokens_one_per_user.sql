-- One active Expo/FCM token per user: new token updates the same row instead of stacking rows.
-- Previous schema: UNIQUE (user_id, token) allowed many rows per user.

DELETE FROM public.push_tokens pt
WHERE pt.id IN (
  SELECT id
  FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY updated_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM public.push_tokens
  ) ranked
  WHERE ranked.rn > 1
);

DROP INDEX IF EXISTS public.push_tokens_user_id_token_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_user_id_uidx ON public.push_tokens (user_id);
