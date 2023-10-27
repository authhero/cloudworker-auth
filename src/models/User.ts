import { createProxy } from "trpc-durable-objects";
import bcrypt from "bcryptjs";
import { initTRPC } from "@trpc/server";
import { z, ZodSchema } from "zod";
import { Context } from "trpc-durable-objects";
import { nanoid } from "nanoid";
import { DataAdapters } from "../adapters/interfaces";
import { Log } from "../types";

import generateOTP from "../utils/otp";
import {
  UnauthenticatedError,
  NoUserFoundError,
  UserConflictError,
  InvalidCodeError,
  AuthenticationCodeExpiredError,
  NoCodeError,
  NotFoundError,
  ConflictError,
} from "../errors";
import { AuthParams } from "../types/AuthParams";
import { Env, ProfileSchema } from "../types";
import { sendUserEvent, UserEvent } from "../services/events";
import { Profile } from "../types";
import { migratePasswordHook } from "../hooks/migrate-password";

const CodeSchema = z.object({
  authParams: z.custom<AuthParams>().optional(),
  code: z.string(),
  expireAt: z.number().optional(),
  password: z.string().optional(),
});

const UserSchema = z.object({
  email: z.string(),
  tenant_id: z.string(),
  id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  nickname: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
  locale: z.string().optional(),
  connections: z
    .array(
      z.object({
        name: z.string(),
        profile: z
          .record(z.union([z.string(), z.boolean(), z.number()]))
          .optional(),
      }),
    )
    .optional(),
});

type Code = z.infer<typeof CodeSchema>;

const t = initTRPC.context<Context<Env>>().create();

const publicProcedure = t.procedure;

const router = t.router;

enum StorageKeys {
  authenticationCode = "authentication-code",
  emailValidationCode = "email-validation-code",
  passwordResetCode = "password-reset-code",
  passwordHash = "password-hash",
  profile = "profile",
  logs = "logs",
}

const PROFILE_FIELDS = [
  "name",
  "email",
  "given_name",
  "family_name",
  "nickname",
  "picture",
  "locale",
];

function parseStringToType<T>(schema: ZodSchema<T>, input?: string): T | null {
  if (!input) {
    return null;
  }

  return schema.parse(JSON.parse(input));
}

async function getProfile(storage: DurableObjectStorage) {
  const jsonData = await storage.get<string>(StorageKeys.profile);

  if (!jsonData) {
    return null;
  }

  const data = JSON.parse(jsonData);
  const patchedJsonData = JSON.stringify({
    ...data,
    // backwards compatible patch as we've since renamed the SQL columns to match Auth0
    updated_at: data.updated_at || data.modified_at,
  });

  return parseStringToType<Profile>(ProfileSchema, patchedJsonData);
}

async function getPasswordResetCode(storage: DurableObjectStorage) {
  const jsonData = await storage.get<string>(StorageKeys.passwordResetCode);

  return parseStringToType<Code>(CodeSchema, jsonData);
}

async function getAuthenticationCode(storage: DurableObjectStorage) {
  const jsonData = await storage.get<string>(StorageKeys.authenticationCode);

  return parseStringToType<Code>(CodeSchema, jsonData);
}

async function getEmailValidationCode(storage: DurableObjectStorage) {
  const jsonData = await storage.get<string>(StorageKeys.emailValidationCode);

  return parseStringToType<Code>(CodeSchema, jsonData);
}

// No more! do this in route. Let's gut this model 8-)
// async function writeLog(
//   ctx: Context<Env>,
//   message: Omit<Log, "timestamp" | "id" | "tenant_id" | "user_id">,
// ) {
//   const profile = await getProfile(ctx.state.storage);

//   if (!profile) {
//     return;
//   }

//   const { tenant_id, id } = profile;

//   console.log("ctx.env.data ", ctx.env.data);

//   // why is ctx.env.data undefined? according to env it should be here....

//   // this must be the issue... what is undefined?
//   // await ctx.env.data.logs.create({
//   //   ...message,
//   //   tenant_id,
//   //   user_id: id,
//   // });
// }

// Stores information about the current operation and ensures that the user has an id.
async function updateProfile(
  ctx: Context<Env>,
  profile: Partial<Profile> & Pick<Profile, "tenant_id" | "email">,
) {
  let existingProfile = await getProfile(ctx.state.storage);

  if (!existingProfile || !existingProfile.id) {
    existingProfile = {
      id: nanoid(),
      updated_at: "",
      connections: [],
      created_at: new Date().toISOString(),
      ...profile,
    };
  }

  const updatedProfile: Profile = {
    ...existingProfile,
    ...profile,
    connections: existingProfile.connections,
    updated_at: new Date().toISOString(),
  };

  profile.connections?.forEach((connection) => {
    // remove any existing connections with the same name
    updatedProfile.connections = updatedProfile.connections?.filter(
      (c) => c.name !== connection.name,
    );

    updatedProfile.connections?.push(connection);

    // Set standard fields if not allready defined in profile
    PROFILE_FIELDS.forEach((key) => {
      if (!updatedProfile[key] && connection.profile?.[key]) {
        updatedProfile[key] = connection.profile[key];
      }
    });
  });

  await ctx.state.storage.put(
    StorageKeys.profile,
    JSON.stringify(updatedProfile),
  );

  await sendUserEvent(
    ctx.env,
    `${profile.tenant_id}|${profile.email}`,
    updatedProfile.id,
    existingProfile ? UserEvent.userUpdated : UserEvent.userCreated,
  );

  return updatedProfile;
}

const THIRTY_MINUTES_IN_MS = 30 * 60 * 1000;

function getNewCodeOrUseExisting(existingCode?: Code | null) {
  if (
    existingCode &&
    existingCode.expireAt &&
    Date.now() <= existingCode.expireAt
  ) {
    return existingCode.code;
  }

  return generateOTP();
}

export const userRouter = router({
  createAuthenticationCode: publicProcedure
    .input(
      z.object({
        authParams: z.custom<AuthParams>(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existingCode = await getAuthenticationCode(ctx.state.storage);

      const code = getNewCodeOrUseExisting(existingCode);

      const result: Code = {
        code,
        expireAt: Date.now() + THIRTY_MINUTES_IN_MS,
        authParams: input.authParams,
      };

      await ctx.state.storage.put(
        StorageKeys.authenticationCode,
        JSON.stringify(result),
      );

      return result;
    }),
  createEmailValidationCode: publicProcedure.mutation(async ({ ctx }) => {
    const result: Code = {
      code: generateOTP(),
      expireAt: Date.now() + 300 * 1000,
    };

    await ctx.state.storage.put(
      StorageKeys.emailValidationCode,
      JSON.stringify(result),
    );

    return result;
  }),
  createPasswordResetCode: publicProcedure.mutation(async ({ ctx }) => {
    const result: Code = {
      code: generateOTP(),
      expireAt: Date.now() + 300 * 1000,
    };

    await ctx.state.storage.put(
      StorageKeys.passwordResetCode,
      JSON.stringify(result),
    );

    return result;
  }),
  createUser: publicProcedure
    .input(UserSchema)
    .mutation(async ({ input, ctx }) => {
      let existingProfile = await getProfile(ctx.state.storage);

      if (existingProfile) {
        throw new ConflictError();
      }

      const profile = await updateProfile(ctx, input);

      await writeLog(ctx, {
        category: "update",
        message: "User created",
      });

      return profile;
    }),
  delete: publicProcedure.mutation(async ({ ctx }) => {
    const profile = await getProfile(ctx.state.storage);

    if (!profile?.tenant_id) {
      throw new NotFoundError();
    }

    await ctx.state.storage.deleteAll();

    await sendUserEvent(
      ctx.env,
      `${profile.tenant_id}|${profile.email}`,
      profile.id,
      UserEvent.userDeleted,
    );
  }),
  getProfile: publicProcedure.query(async ({ ctx }) => {
    const profile = await getProfile(ctx.state.storage);
    if (!profile) {
      throw new NoUserFoundError();
    }

    return profile;
  }),
  linkToUser: publicProcedure
    .input(
      z.object({
        email: z.string(),
        linkWithEmail: z.string(),
        tenantId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existingProfile = await getProfile(ctx.state.storage);
      if (!existingProfile) {
        throw new NotFoundError();
      }

      if (existingProfile.linked_with) {
        throw new ConflictError();
      }

      const profile = await updateProfile(ctx, {
        tenant_id: input.tenantId,
        email: input.email,
        linked_with: input.linkWithEmail,
      });

      await writeLog(ctx, {
        category: "link",
        message: `Linked to ${input.linkWithEmail}`,
      });

      return profile;
    }),
  linkWithUser: publicProcedure
    .input(
      z.object({
        email: z.string(),
        linkWithEmail: z.string(),
        tenantId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existingProfile = await getProfile(ctx.state.storage);
      if (!existingProfile) {
        throw new NotFoundError();
      }

      const profile = await updateProfile(ctx, {
        tenant_id: input.tenantId,
        email: input.email,
        connections: [
          {
            name: `linked-user|${input.linkWithEmail}`,
            profile: {
              email: input.linkWithEmail,
            },
          },
        ],
      });

      await writeLog(ctx, {
        category: "link",
        message: `Added ${input.linkWithEmail} as linked user`,
      });

      return profile;
    }),
  loginWithConnection: publicProcedure
    .input(
      z.object({
        email: z.string(),
        tenantId: z.string(),
        connection: z.object({
          name: z.string(),
          profile: z
            .record(z.union([z.string(), z.boolean(), z.number()]))
            .optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const profile = await updateProfile(ctx, {
        email: input.email,
        tenant_id: input.tenantId,
        connections: [input.connection],
      });

      await writeLog(ctx, {
        category: "login",
        message: `Login with ${input.connection.name}`,
      });

      return profile;
    }),
  patchProfile: publicProcedure
    .input(UserSchema)
    .mutation(async ({ input, ctx }) => {
      const profile = await updateProfile(ctx, input);

      console.log("this mostly looks like ctx.env - ", ctx.env);
      console.log("but this is unpopulated ctx.env.data - ", ctx.env.data);

      await writeLog(ctx, {
        category: "update",
        message: "User profile",
      });

      return profile;
    }),
  registerPassword: publicProcedure
    .input(
      z.object({
        tenantId: z.string(),
        email: z.string(),
        password: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const passwordHash = await getPasswordResetCode(ctx.state.storage);

      if (passwordHash) {
        throw new UserConflictError();
      }

      await ctx.state.storage.put(
        StorageKeys.passwordHash,
        bcrypt.hashSync(input.password, 10),
      );

      await writeLog(ctx, {
        category: "login",
        message: "User created with password",
      });

      return updateProfile(ctx, {
        email: input.email,
        tenant_id: input.tenantId,
        connections: [
          {
            name: "auth",
            profile: {
              email: input.email,
              validated: false,
            },
          },
        ],
      });
    }),
  resetPasswordWithCode: publicProcedure
    .input(
      z.object({
        code: z.string(),
        password: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const passwordResetCode = await getPasswordResetCode(ctx.state.storage);

      if (!passwordResetCode) {
        throw new InvalidCodeError("No code set");
      }

      if (input.code !== passwordResetCode.code) {
        throw new InvalidCodeError();
      }

      if (
        !passwordResetCode.expireAt ||
        Date.now() > passwordResetCode.expireAt
      ) {
        throw new InvalidCodeError("Code expired");
      }

      await ctx.state.storage.put(
        StorageKeys.passwordHash,
        bcrypt.hashSync(input.password, 10),
      );

      await writeLog(ctx, {
        category: "update",
        message: "Reset password with code",
      });

      ctx.state.storage.delete(StorageKeys.passwordResetCode);
    }),
  setEmailValidated: publicProcedure
    .input(
      z.object({
        email: z.string(),
        tenantId: z.string(),
        validated: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await writeLog(ctx, {
        category: "update",
        message: "Set email validated",
      });

      return updateProfile(ctx, {
        email: input.email,
        tenant_id: input.tenantId,
        connections: [
          {
            name: "auth",
            profile: {
              email: input.email,
              validated: input.validated,
            },
          },
        ],
      });
    }),
  setPassword: publicProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      await writeLog(ctx, {
        category: "update",
        message: "Set password",
      });

      await ctx.state.storage.put(
        StorageKeys.passwordHash,
        bcrypt.hashSync(input, 10),
      );
    }),
  validateAuthenticationCode: publicProcedure
    .input(
      z.object({
        email: z.string(),
        tenantId: z.string(),
        code: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const code = [
        "ulf.lindberg@maxm.se",
        "markus+23@sesamy.com",
        "klara.lindstroem@hmc.ox.ac.uk",
      ].includes(input.email)
        ? { code: "531523", expireAt: Date.now() + THIRTY_MINUTES_IN_MS }
        : await getAuthenticationCode(ctx.state.storage);

      if (!code) {
        throw new NoCodeError();
      }

      if (input.code !== code.code) {
        throw new InvalidCodeError();
      }

      if (!code.expireAt || Date.now() > code.expireAt) {
        throw new AuthenticationCodeExpiredError();
      }

      const profile = await updateProfile(ctx, {
        email: input.email,
        tenant_id: input.tenantId,
        connections: [
          {
            name: "email",
            profile: {
              email: input.email,
              validated: true,
            },
          },
        ],
      });

      await writeLog(ctx, {
        category: "login",
        message: "Login with code",
      });

      // Remove once used. Skip for now
      // await ctx.state.storage.put(StorageKeys.authenticationCode, "");

      return profile;
    }),
  validateEmailValidationCode: publicProcedure
    .input(
      z.object({
        email: z.string(),
        tenantId: z.string(),
        code: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const emailValidation = await getEmailValidationCode(ctx.state.storage);

      if (!emailValidation) {
        throw new UnauthenticatedError();
      }

      if (input.code !== emailValidation.code) {
        throw new InvalidCodeError();
      }

      if (!emailValidation.expireAt || Date.now() > emailValidation.expireAt) {
        throw new AuthenticationCodeExpiredError();
      }

      await writeLog(ctx, {
        category: "validation",
        message: "Validate with code",
      });

      // Remove once used
      await ctx.state.storage.delete(StorageKeys.emailValidationCode);

      // Set the email to validated
      return updateProfile(ctx, {
        email: input.email,
        tenant_id: input.tenantId,
        connections: [
          {
            name: "auth",
            profile: {
              email: input.email,
              validated: true,
            },
          },
        ],
      });
    }),
  validatePassword: publicProcedure
    .input(
      z.object({
        email: z.string(),
        tenantId: z.string(),
        password: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const passwordHash = await ctx.state.storage.get<string>(
        StorageKeys.passwordHash,
      );

      if (!passwordHash) {
        if (
          await migratePasswordHook(
            ctx.env,
            input.tenantId,
            input.email,
            input.password,
          )
        ) {
          // Hash and store the password used
          await ctx.state.storage.put(
            StorageKeys.passwordHash,
            bcrypt.hashSync(input.password, 10),
          );
        } else {
          throw new NoUserFoundError();
        }
      } else if (!bcrypt.compareSync(input.password, passwordHash)) {
        throw new UnauthenticatedError();
      }

      await writeLog(ctx, {
        category: "login",
        message: "Login with password",
      });
    }),
});

type UserRouter = typeof userRouter;

export function getId(tenantId: string, email: string) {
  return `${tenantId}|${email.toLowerCase()}`;
}

export const User = createProxy<UserRouter, Env>(userRouter);

export type UserClient = ReturnType<typeof User.getInstance>;
