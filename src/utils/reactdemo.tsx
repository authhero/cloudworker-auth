import type { FC } from "hono/jsx";
import { Context } from "hono";
import { Var } from "../types/Var";
import { Env } from "../types/Env";
import Layout from "./components/Layout";

const ResetPasswordPage: FC<{}> = (props: {}) => {
  return (
    <Layout title="Reset Password">
      <div className="mb-8 text-2xl font-medium">Reset password</div>
      <div className="flex flex-1 flex-col justify-center">
        <form
        // TODO - use default form action
        // onSubmit={handleSubmit}
        >
          <input
            type="text"
            name="password"
            placeholder="enter new password"
            className="mb-2 w-full rounded-lg bg-gray-100 px-4 py-5 text-base placeholder:text-gray-300 dark:bg-gray-600 md:text-base"
          />
          {/* {!!error && <em className="mb-2 bg-red">{error}</e  m>} */}
          {/* TODO - copy this component over */}
          <button
            className="text-base text-white sm:mt-4 md:text-base"
            // isLoading={isSubmitting}
            type="submit"
          >
            Change password
          </button>
        </form>
      </div>
    </Layout>
  );
};

export async function renderReactThing(
  ctx: Context<{ Bindings: Env; Variables: Var }>,
) {
  // we could make app.ts into app.tsx and render the JSX there directly...
  // I figure we should have a JSX-only file that adds lots of routes?
  return ctx.html(<ResetPasswordPage />);
}
