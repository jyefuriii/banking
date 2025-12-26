"use server";

import { ID, Query } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { cookies } from "next/headers";
import { encryptId, extractCustomerIdFromUrl, parseStringify } from "../utils";
import {
  CountryCode,
  ProcessorTokenCreateRequest,
  ProcessorTokenCreateRequestProcessorEnum,
  Products,
} from "plaid";

import { plaidClient } from "@/lib/plaid";
import { revalidatePath } from "next/cache";
import { addFundingSource, createDwollaCustomer } from "./dwolla.actions";

const {
  APPWRITE_DATABASE_ID: DATABASE_ID,
  APPWRITE_USER_COLLECTION_ID: USER_COLLECTION_ID,
  APPWRITE_BANK_COLLECTION_ID: BANK_COLLECTION_ID,
} = process.env;

export const getUserInfo = async ({ userId }: getUserInfoProps) => {
  try {
    const { database } = await createAdminClient();

    const user = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [Query.equal("userId", [userId])]
    );

    if (!user.documents || user.documents.length === 0) {
      console.log(`No user document found for userId: ${userId}`);
      return null;
    }

    return parseStringify(user.documents[0]);
  } catch (error) {
    console.error("Error in getUserInfo:", error);
    return null;
  }
};

export const signIn = async ({ email, password }: signInProps) => {
  try {
    const { account } = await createAdminClient();
    const session = await account.createEmailPasswordSession(email, password);

    (await cookies()).set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    const user = await getUserInfo({ userId: session.userId });

    if (!user) {
      // Get account info to help debug
      try {
        const accountInfo = await account.get();
        console.error(`User document missing for userId: ${session.userId}, email: ${accountInfo.email}`);
      } catch (accountError) {
        console.error("Error getting account info:", accountError);
      }
      // Throw a specific error that won't be confused with invalid credentials
      const profileError = new Error("PROFILE_DATA_MISSING: Your account exists but profile data is missing. This may have occurred during sign-up. Please try signing up again or contact support.");
      throw profileError;
    }

    return parseStringify(user);
  } catch (error: any) {
    console.error("Sign in error details:", {
      message: error?.message,
      code: error?.code,
      type: error?.type,
      response: error?.response,
      error: error
    });
    
    // If this is our profile data missing error, re-throw it as-is
    if (error?.message?.includes("PROFILE_DATA_MISSING")) {
      throw error;
    }
    
    // Only classify as invalid credentials if it's specifically about authentication
    // Appwrite typically throws errors with specific messages for invalid credentials
    const errorMessage = error?.message?.toLowerCase() || "";
    const isInvalidCredentials = 
      (errorMessage.includes("invalid credentials") && !errorMessage.includes("profile")) || 
      (errorMessage.includes("invalid password") && !errorMessage.includes("profile")) ||
      (errorMessage.includes("wrong password") && !errorMessage.includes("profile")) ||
      (errorMessage.includes("user not found") && !errorMessage.includes("profile")) ||
      (error?.code === 401 && errorMessage.includes("unauthorized") && !errorMessage.includes("profile"));
    
    if (isInvalidCredentials) {
      throw new Error("Invalid email or password. Please try again.");
    }
    
    // Re-throw the original error so the actual message is preserved
    throw error;
  }
};

export const signUp = async ({ password, ...userData }: SignUpParams) => {
  const { email, firstName, lastName } = userData;

  let newUserAccount;

  try {
    const { account, database } = await createAdminClient();

    newUserAccount = await account.create(
      ID.unique(),
      email,
      password,
      `${firstName} ${lastName}`
    );

    if (!newUserAccount) throw new Error("Error creating user account");

    const dwollaCustomerUrl = await createDwollaCustomer({
      ...userData,
      type: "personal",
    });

    if (!dwollaCustomerUrl) {
      // Clean up: delete the Appwrite account if Dwolla fails
      try {
        await account.deleteIdentity(newUserAccount.$id);
      } catch (cleanupError) {
        console.error("Failed to cleanup account:", cleanupError);
      }
      throw new Error("Error creating Dwolla customer. Please try again.");
    }

    const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl);

    const newUser = await database.createDocument(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      ID.unique(),
      {
        ...userData,
        userId: newUserAccount.$id,
        dwollaCustomerId,
        dwollaCustomerUrl,
      }
    );

    if (!newUser) {
      // Clean up: delete the Appwrite account if database creation fails
      try {
        await account.deleteIdentity(newUserAccount.$id);
      } catch (cleanupError) {
        console.error("Failed to cleanup account:", cleanupError);
      }
      throw new Error("Error creating user profile. Please try again.");
    }

    const session = await account.createEmailPasswordSession(email, password);

    (await cookies()).set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    return parseStringify(newUser);
  } catch (error: any) {
    console.error("Sign up error:", error);
    
    // Handle case where account exists but database document is missing (recovery)
    if (error?.message?.includes("already exists") || 
        error?.message?.includes("already registered") ||
        error?.code === 409) {
      
      // Try to recover: check if database document exists, if not create it
      try {
        const { account: existingAccount, database } = await createAdminClient();
        
        // Try to get the account by attempting to create a session (this will fail if password is wrong)
        let existingUserId: string | null = null;
        try {
          const testSession = await existingAccount.createEmailPasswordSession(email, password);
          existingUserId = testSession.userId;
          // Delete the test session
          await existingAccount.deleteSession(testSession.$id);
        } catch (sessionError: any) {
          // If session creation fails, it means password is wrong or account doesn't exist
          throw new Error("An account with this email already exists. Please sign in instead.");
        }

        if (existingUserId) {
          // Check if database document exists
          const existingUser = await getUserInfo({ userId: existingUserId });
          
          if (!existingUser) {
            // Account exists but document doesn't - create the document
            console.log("Recovering: Creating missing database document for existing account");
            
            const dwollaCustomerUrl = await createDwollaCustomer({
              ...userData,
              type: "personal",
            });

            if (!dwollaCustomerUrl) {
              throw new Error("Error creating Dwolla customer. Please try again.");
            }

            const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl);

            const recoveredUser = await database.createDocument(
              DATABASE_ID!,
              USER_COLLECTION_ID!,
              ID.unique(),
              {
                ...userData,
                userId: existingUserId,
                dwollaCustomerId,
                dwollaCustomerUrl,
              }
            );

            if (recoveredUser) {
              // Create session and return
              const session = await existingAccount.createEmailPasswordSession(email, password);
              (await cookies()).set("appwrite-session", session.secret, {
                path: "/",
                httpOnly: true,
                sameSite: "strict",
                secure: true,
              });
              return parseStringify(recoveredUser);
            }
          } else {
            // Both account and document exist
            throw new Error("An account with this email already exists. Please sign in instead.");
          }
        }
      } catch (recoveryError: any) {
        // If recovery fails, throw the original error
        if (recoveryError.message.includes("already exists")) {
          throw recoveryError;
        }
        throw new Error("An account with this email already exists. Please sign in instead.");
      }
      
      throw new Error("An account with this email already exists. Please sign in instead.");
    }
    
    // Re-throw the error so it can be caught and displayed
    throw error;
  }
};

export async function getLoggedInUser() {
  try {
    const { account } = await createSessionClient();
    const result = await account.get();

    const user = await getUserInfo({ userId: result.$id });

    return parseStringify(user);
  } catch (error) {
    console.log(error);
    return null;
  }
}

export const logoutAccount = async () => {
  try {
    const { account } = await createSessionClient();

    (await cookies()).delete("appwrite-session");

    await account.deleteSession("current");
  } catch {
    // Error handling - ignore
    return null;
  }
};

export const createLinkToken = async (user: User) => {
  try {
    const tokenParams = {
      user: {
        client_user_id: user.$id,
      },
      client_name: `${user.firstName} ${user.lastName}`,
      products: ["auth", "transactions"] as Products[],
      language: "en",
      country_codes: ["US"] as CountryCode[],
    };

    const response = await plaidClient.linkTokenCreate(tokenParams);

    return parseStringify({ linkToken: response.data.link_token });
  } catch (error) {
    console.log(error);
  }
};

export const createBankAccount = async ({
  userId,
  bankId,
  accountId,
  accessToken,
  fundingSourceUrl,
  shareableId,
}: createBankAccountProps) => {
  try {
    const { database } = await createAdminClient();

    const bankAccount = await database.createDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      ID.unique(),
      {
        userId,
        bankId,
        accountId,
        accessToken,
        fundingSourceUrl,
        shareableId,
      }
    );

    return parseStringify(bankAccount);
  } catch (error) {
    console.log(error);
  }
};

export const exchangePublicToken = async ({
  publicToken,
  user,
}: exchangePublicTokenProps) => {
  try {
    // Exchange public token for access token and item ID
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Get account information from Plaid using the access token
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    const accountData = accountsResponse.data.accounts[0];

    // Create a processor token for Dwolla using the access token and account ID
    const request: ProcessorTokenCreateRequest = {
      access_token: accessToken,
      account_id: accountData.account_id,
      processor: "dwolla" as ProcessorTokenCreateRequestProcessorEnum,
    };

    const processorTokenResponse = await plaidClient.processorTokenCreate(
      request
    );
    const processorToken = processorTokenResponse.data.processor_token;

    // Create a funding source URL for the account using the Dwolla customer ID, processor token, and bank name
    const fundingSourceUrl = await addFundingSource({
      dwollaCustomerId: user.dwollaCustomerId,
      processorToken,
      bankName: accountData.name,
    });

    // If the funding source URL is not created, throw an error
    if (!fundingSourceUrl) throw Error;

    // Create a bank account using the user ID, item ID, account ID, access token, funding source URL, and shareableId ID
    await createBankAccount({
      userId: user.$id,
      bankId: itemId,
      accountId: accountData.account_id,
      accessToken,
      fundingSourceUrl,
      shareableId: encryptId(accountData.account_id),
    });

    // Revalidate the path to reflect the changes
    revalidatePath("/");

    // Return a success message
    return parseStringify({
      publicTokenExchange: "complete",
    });
  } catch (error) {
    console.error("An error occurred while creating exchanging token:", error);
  }
};

export const getBanks = async ({ userId }: getBanksProps) => {
  try {
    const { database } = await createAdminClient();

    const banks = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal("userId", [userId])]
    );

    return parseStringify(banks.documents);
  } catch (error) {
    console.log(error);
  }
};

export const getBank = async ({ documentId }: getBankProps) => {
  try {
    const { database } = await createAdminClient();

    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal("$id", [documentId])]
    );

    if (!bank.documents || bank.documents.length === 0) {
      return null;
    }

    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.error("Error getting bank:", error);
    return null;
  }
};

export const getBankByAccountId = async ({
  accountId,
}: getBankByAccountIdProps) => {
  try {
    const { database } = await createAdminClient();

    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal("accountId", [accountId])]
    );

    if (bank.total !== 1) return null;

    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.log(error);
  }
};
