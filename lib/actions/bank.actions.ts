"use server";

import { CountryCode } from "plaid";

import { plaidClient } from "../plaid";
import { parseStringify } from "../utils";

import { getTransactionsByBankId } from "./transaction.actions";
import { getBanks, getBank } from "./user.actions";

// Get multiple bank accounts
export const getAccounts = async ({ userId }: getAccountsProps) => {
  try {
    // get banks from db
    const banks = await getBanks({ userId });

    const accounts = await Promise.all(
      banks?.map(async (bank: Bank) => {
        // get each account info from plaid
        const accountsResponse = await plaidClient.accountsGet({
          access_token: bank.accessToken,
        });
        const accountData = accountsResponse.data.accounts[0];

        // get institution info from plaid
        const institution = await getInstitution({
          institutionId: accountsResponse.data.item.institution_id!,
        });

        const account = {
          id: accountData.account_id,
          availableBalance: accountData.balances.available!,
          currentBalance: accountData.balances.current!,
          institutionId: institution.institution_id,
          name: accountData.name,
          officialName: accountData.official_name,
          mask: accountData.mask!,
          type: accountData.type as string,
          subtype: accountData.subtype! as string,
          appwriteItemId: bank.$id,
          shareableId: bank.shareableId,
        };

        return account;
      })
    );

    const totalBanks = accounts.length;
    const totalCurrentBalance = accounts.reduce((total, account) => {
      return total + account.currentBalance;
    }, 0);

    return parseStringify({ data: accounts, totalBanks, totalCurrentBalance });
  } catch (error) {
    console.error("An error occurred while getting the accounts:", error);
  }
};

// Get one bank account
export const getAccount = async ({ appwriteItemId }: getAccountProps) => {
  try {
    // get bank from db
    const bank = await getBank({ documentId: appwriteItemId });
    
    if (!bank) {
      console.error(`Bank account not found for appwriteItemId: ${appwriteItemId}`);
      return null;
    }
    
    console.log("Bank Data:", bank);
    
    if (!bank.accessToken) {
      console.error("Bank account missing accessToken");
      return null;
    }
    
    // get account info from plaid
    const accountsResponse = await plaidClient.accountsGet({
      access_token: bank.accessToken,
    });
    console.log("Plaid Accounts Response:", accountsResponse);
    const accountData = accountsResponse.data.accounts[0];

    // get transfer transactions from appwrite
    const transferTransactionsData = await getTransactionsByBankId({
      bankId: bank.$id,
    });

    const transferTransactions = transferTransactionsData.documents.map(
      (transferData: Transaction) => ({
        id: transferData.$id,
        name: transferData.name!,
        amount: transferData.amount!,
        date: transferData.$createdAt,
        paymentChannel: transferData.channel,
        category: transferData.category,
        type: transferData.senderBankId === bank.$id ? "debit" : "credit",
      })
    );

    // get institution info from plaid
    const institution = await getInstitution({
      institutionId: accountsResponse.data.item.institution_id!,
    });

    const transactions = await getTransactions({
      accessToken: bank?.accessToken,
    });

    const account = {
      id: accountData.account_id,
      availableBalance: accountData.balances.available!,
      currentBalance: accountData.balances.current!,
      institutionId: institution.institution_id,
      name: accountData.name,
      officialName: accountData.official_name,
      mask: accountData.mask!,
      type: accountData.type as string,
      subtype: accountData.subtype! as string,
      appwriteItemId: bank.$id,
    };

    // sort transactions by date such that the most recent transaction is first
    const allTransactions = [
      ...(Array.isArray(transactions) ? transactions : []),
      ...(Array.isArray(transferTransactions) ? transferTransactions : []),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return parseStringify({
      data: account,
      transactions: allTransactions,
    });
  } catch (error) {
    console.error("An error occurred while getting the account:", error);
  }
};

// Get bank info
export const getInstitution = async ({
  institutionId,
}: getInstitutionProps) => {
  try {
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: ["US"] as CountryCode[],
    });

    const intitution = institutionResponse.data.institution;

    return parseStringify(intitution);
  } catch (error) {
    console.error("An error occurred while getting the accounts:", error);
  }
};

// Get transactions
export const getTransactions = async ({
  accessToken,
}: getTransactionsProps) => {
  let hasMore = true;
  let transactions: Array<Record<string, unknown>> = [];
  let cursor: string | undefined = undefined;

  try {
    // Validate access token
    if (!accessToken) {
      console.error("Access token is missing");
      return parseStringify([]);
    }

    // Iterate through each page of new transaction updates for item
    while (hasMore) {
      const requestParams: any = {
        access_token: accessToken,
      };

      // Only include cursor if we have one (first call uses empty string)
      if (cursor !== undefined) {
        requestParams.cursor = cursor;
      } else {
        // First call - use empty string for initial sync
        requestParams.cursor = "";
      }

      const response = await plaidClient.transactionsSync(requestParams);

      const data = response.data;
      
      // Update cursor for next iteration
      cursor = data.next_cursor;
      
      // Ensure that data.added is an array before trying to map over it
      if (Array.isArray(data.added)) {
        transactions = [
          ...transactions,
          ...data.added.map((transaction) => ({
            id: transaction.transaction_id,
            name: transaction.name,
            paymentChannel: transaction.payment_channel,
            type: transaction.payment_channel,
            accountId: transaction.account_id,
            amount: transaction.amount,
            pending: transaction.pending,
            category: transaction.category ? transaction.category[0] : "",
            date: transaction.date,
            image: transaction.logo_url,
          })),
        ];
      } else {
        console.error("Error: response data.added is not an array");
      }

      hasMore = data.has_more; // Check if there are more transactions to fetch
    }

    return parseStringify(transactions);
  } catch (error: any) {
    console.error("An error occurred while getting transactions:", {
      message: error?.message,
      response: error?.response?.data,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      error: error
    });
    
    // Log detailed Plaid error if available
    if (error?.response?.data) {
      const plaidError = error.response.data;
      console.error("Plaid API error details:", {
        error_code: plaidError.error_code,
        error_message: plaidError.error_message,
        error_type: plaidError.error_type,
        display_message: plaidError.display_message,
        request_id: plaidError.request_id
      });
    }
    
    // If it's a 400 error, it might be because the access token is invalid or expired
    if (error?.response?.status === 400) {
      const errorMessage = error?.response?.data?.error_message || error?.message || "Unknown error";
      const errorCode = error?.response?.data?.error_code;
      console.error(`Plaid API 400 error: ${errorMessage}`);
      
      // Common Plaid 400 errors:
      if (errorMessage.includes("INVALID_ACCESS_TOKEN") || errorMessage.includes("ITEM_LOGIN_REQUIRED")) {
        console.error("Access token is invalid or expired. User needs to re-link their bank account.");
      } else if (errorCode === "ADDITIONAL_CONSENT_REQUIRED" || errorMessage.includes("PRODUCT_TRANSACTIONS")) {
        console.error("Bank account was linked without transactions consent. User needs to re-link the account with transactions product enabled.");
        // Return empty array but log a clear message
        return parseStringify([]);
      }
    }
    
    return parseStringify([]);
  }
};
