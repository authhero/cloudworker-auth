const fs = require("fs");
const csv = require("csv-parser");

const token =
  "eyJraWQiOiJZdjdFdFNWalRjcDZVS3k4SzBCa08iLCJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJkZWZhdWx0Iiwic2NvcGUiOiJvcGVuaWQgZW1haWwgcHJvZmlsZSIsInBlcm1pc3Npb25zIjpbImF1dGg6cmVhZCIsImF1dGg6d3JpdGUiLCJyZWFkOnN0YXRlIl0sInN1YiI6Imdvb2dsZS1vYXV0aDJ8MTA4NzkxMDA0NjcxMDcyODE3Nzk0Iiwia2lkIjoiWXY3RXRTVmpUY3A2VUt5OEswQmtPIiwiaXNzIjoiaHR0cHM6Ly90b2tlbi5zZXNhbXkuY29tLyIsImlhdCI6MTczNjc5Mzc4OCwiZXhwIjoxNzM2ODgwMTg4fQ.uUvtudJev3y6QgV1jvjU9oOc1A_uIfxaG42ugCnzZ1_RLUm0ACxtGVAzRQQMqhy6jV4DC5H1ADlNwZMDMjyH-Wv5DjTHX--iiOgnuKB8cwXuFyt2nJbb10d3poTonYQbVErIO0TWqL63ACMu-YJOMY5V5eWkDCmi4N6yTvSU509rlrYvRUDwHhK9HTX-LD8Exd9crN6legBW_X0CoNBuBAfZQzSeI1vwvJgU7Xy1ASMfS94KpluTcjiR_pEUoman-FJVca1va-HDVluUITIX0tteviSod7Vx6bx8lQ8m9uJubCrYPMUPO3JLz0TegpTUDuWb_v6YriCcPBYCOV7hV3R5ovtMSd3_lc5KDB6po5_GTh3pnGsdRd0swyFywX9bapWV-9PQs3aZ1_8DRtmrHlfRdOnTULylsuzy4eHoa1NOMJ4Pgt0pARC-ehr9_KfHrg5ZwbErjZ7UyBX-arnGMdbETHJMZnnB7GhjcTwCm0Ijj-UOS-BJrKHudFZJ0cUEOI6iMkJHNa3pvCJ46B2uItmK1coL3VhnfmHs0E5dFCEEzXnJJIFQ9P6OUDdRhZm7BdiiYQgioxxTs7KYxlADk4mHE_ujZqxA8Kx-29I8yFSpBq7bQIY1len_A77JKSvPVhYo9wTVvhtWl5N2q0YyPJ-PBCDAM6Pnw_ZVoZwbxDM";
const vendor = "fokus";

async function getExistingUsers(lastUserId) {
  const per_page = 1;

  const url = new URL("http://auth2.sesamy.com/api/v2/users");
  url.searchParams.append("per_page", "1");
  url.searchParams.append("sort", "user_id:1");
  url.searchParams.append("include_totals", "false");

  if (lastUserId) {
    url.searchParams.append("q", `user_id:>${lastUserId}`);
  }

  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "tenant-id": "A-bFAG1IGuW4vGQM3yhca",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch users. Status: ${response.status}, with error ${await response.text()}`
    );
  }

  const body = await response.json();
  console.log(
    "Body: ",
    body.map((u) => u.user_id)
  );

  if (body.length === per_page) {
    const lastUser = body[body.length - 1];
    const lastUserId = lastUser.user_id;

    return [...body, ...(await getExistingUsers(lastUserId))];
  }

  return body;
}

function getProviderAndId(id) {
  const [provider, userId] = id.split("|");

  switch (provider) {
    case "google-oauth2":
      return {
        provider: "google-oauth2",
        connection: "google-oauth2",
        user_id: userId,
        is_social: true,
      };
    case "facebook":
      return {
        provider: "facebook",
        connection: "facebook",
        user_id: userId,
        is_social: true,
      };
    case "apple":
      return {
        provider: "apple",
        connection: "apple",
        user_id: userId,
        is_social: true,
      };
    case "email":
      return { provider: "email", connection: "email", user_id: userId };
    case "auth0":
      return {
        provider: "auth0",
        connection: "Username-Password-Authentication",
        user_id: userId,
      };
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
async function postUser(user) {
  const userId = user["User id"];

  const existingUserResponse = await fetch(
    `https://auth2.sesamy.com/api/v2/users/${userId}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        // The master tenant id
        "tenant-id": "2pcx5edjYqVDJCOhgwcik",
      },
    }
  );

  if (!existingUserResponse.ok) {
    console.log(
      `Failed to fetch user ${userId} with status ${existingUserResponse.status}`
    );
    return;
  }

  const existingUser = await existingUserResponse.json();

  if (existingUser.linked_to) {
    console.log(`User ${userId} is linked`);
    return;
  }

  const linkedUsers = existingUser.identities.slice(1);

  const body = JSON.stringify({
    name: user["Address Name"],
    email: user.Email,
    nickname: user["Nickname"],
    picture: user.picture || "", // Assuming there's no picture field in CSV, add a default or handle it accordingly
    given_name: user["First Name"],
    family_name: user["Last name"],
    created_at: user["User creation date"],
    modified_at: user["User modified date"],
    ...getProviderAndId(userId),
  });

  const response = await fetch("https://auth2.sesamy.com/api/v2/users", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "tenant-id": vendor,
    },
    body,
  });

  if (!response.ok) {
    console.log(
      `Status: ${response.status}, with error ${await response.text()}`
    );
  } else {
    console.log(`User: ${user["User id"]} posted successfully`);

    await Promise.all(
      linkedUsers.map(async (linkedUser) => {
        const linkedUserId = `${linkedUser.provider}|${linkedUser.user_id}`;

        const linkedUserBody = JSON.stringify({
          ...linkedUser.profileData,
          created_at: user["User creation date"],
          modified_at: user["User modified date"],
          linked_to: user["User id"],
          ...getProviderAndId(linkedUserId),
        });

        const linkedeUserResponse = await fetch(
          "https://auth2.sesamy.com/api/v2/users",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "tenant-id": vendor,
            },
            body: linkedUserBody,
          }
        );

        if (!linkedeUserResponse.ok) {
          console.log(`Linked user: ${linkedUserId} failed to post`);
          if (linkedeUserResponse.status === 409) {
            const existingLinkedeUserResponse = await fetch(
              `https://auth2.sesamy.com/api/v2/users/${linkedUserId}`,
              {
                headers: {
                  authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                  "tenant-id": vendor,
                },
              }
            );

            if (!existingLinkedeUserResponse.ok) {
              console.log(`Failed to fetch linked user ${linkedUserId}`);
              return;
            }

            const existingLinkedUser = await existingLinkedeUserResponse.json();
            if (existingLinkedUser.linked_to) {
              console.log(`Linked user: ${linkedUserId} is already linked`);
              return;
            }

            console.log(`Linked user: ${linkedUserId} neeeds to be linked`);
          } else {
            console.log(
              `Failed to create linked user ${linkedUserBody}. Status: ${linkedeUserResponse.status}, with error ${await linkedeUserResponse.text()}`
            );
          }
        } else {
          console.log(`Linked user: ${linkedUserId} posted successfully`);
        }
      })
    );
  }
}

async function importUsers(filePath) {
  // const existingUsers = await getExistingUsers();

  const fileStream = fs.createReadStream(filePath);

  const users = [];

  fileStream
    .pipe(
      csv({
        separator: ";", // Use semicolon as delimiter
        // separator: ",", // Use semicolon as delimiter
        quote: '"', // Specify quote character
        escape: '"', // Specify escape character
        strict: true, // Enable strict mode
        trim: true, // Trim whitespace from fields
      })
    )
    .on("data", (data) => users.push(data))
    .on("end", async () => {
      for (const user of users.reverse()) {
        try {
          await postUser(user);
        } catch (error) {
          console.error(
            `Failed to post user: ${user["User id"]}. Error: ${error.message}`
          );
        }
      }
    });
}

importUsers(`./data/${vendor}.csv`);
