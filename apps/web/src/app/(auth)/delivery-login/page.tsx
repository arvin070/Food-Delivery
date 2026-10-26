import Link from "next/link";
import { LoginForm } from "../login/LoginForm";
export const metadata = { title: "Delivery partner sign in" };
export default function DeliveryLogin() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Delivery partner sign in</h1>
      <p className="mt-2 text-sm text-slate-500">
        Use your assigned partner account to view today’s routes.
      </p>
      <div className="mt-6">
        <LoginForm nextPath="/delivery" />
      </div>
      <Link className="mt-5 inline-block py-3 text-sm" href="/forgot-password">
        Forgot password?
      </Link>
    </>
  );
}
