-- Use the existing server-verified demo login flow without sending an SMS.
INSERT INTO public.demo_users (phone, otp, full_name, active)
VALUES ('9909049699', '111298', 'Demo user', true)
ON CONFLICT (phone) DO UPDATE
SET otp = EXCLUDED.otp, active = EXCLUDED.active;
