"use server";

import { Client } from "dwolla-v2";

const getEnvironment = (): "production" | "sandbox" => {
  const environment = process.env.DWOLLA_ENV as string;

  switch (environment) {
    case "sandbox":
      return "sandbox";
    case "production":
      return "production";
    default:
      throw new Error(
        "Dwolla environment should either be set to `sandbox` or `production`"
      );
  }
};

const dwollaClient = new Client({
  environment: getEnvironment(),
  key: process.env.DWOLLA_KEY as string,
  secret: process.env.DWOLLA_SECRET as string,
});

// Create a Dwolla Funding Source using a Plaid Processor Token
export const createFundingSource = async (
  options: CreateFundingSourceOptions
) => {
  try {
    return await dwollaClient
      .post(`customers/${options.customerId}/funding-sources`, {
        name: options.fundingSourceName,
        plaidToken: options.plaidToken,
      })
      .then((res) => res.headers.get("location"));
  } catch (err) {
    console.error("Creating a Funding Source Failed: ", err);
  }
};

export const createOnDemandAuthorization = async () => {
  try {
    const onDemandAuthorization = await dwollaClient.post(
      "on-demand-authorizations"
    );
    const authLink = onDemandAuthorization.body._links;
    return authLink;
  } catch (err) {
    console.error("Creating an On Demand Authorization Failed: ", err);
  }
};

export const createDwollaCustomer = async (
  newCustomer: NewDwollaCustomerParams
) => {
  try {
    // Validate required environment variables
    if (!process.env.DWOLLA_KEY || !process.env.DWOLLA_SECRET) {
      throw new Error("Dwolla credentials are not configured. Please check your environment variables.");
    }

    if (!process.env.DWOLLA_ENV) {
      throw new Error("Dwolla environment is not set. Please set DWOLLA_ENV to 'sandbox' or 'production'.");
    }

    // Format the customer data according to Dwolla API requirements
    const dwollaCustomerData = {
      firstName: newCustomer.firstName,
      lastName: newCustomer.lastName,
      email: newCustomer.email,
      type: newCustomer.type, // "personal" or "business"
      address1: newCustomer.address1,
      city: newCustomer.city,
      state: newCustomer.state,
      postalCode: newCustomer.postalCode,
      dateOfBirth: newCustomer.dateOfBirth, // Format: YYYY-MM-DD
      ssn: newCustomer.ssn, // Format: XXXX (last 4 digits) or full SSN
    };

    console.log("Creating Dwolla customer with data:", {
      ...dwollaCustomerData,
      ssn: dwollaCustomerData.ssn ? "***" + dwollaCustomerData.ssn.slice(-4) : "not provided"
    });

    const response = await dwollaClient.post("customers", dwollaCustomerData);
    const location = response.headers.get("location");
    
    if (!location) {
      throw new Error("Dwolla customer created but no location URL returned.");
    }
    
    console.log("Dwolla customer created successfully:", location);
    return location;
  } catch (err: any) {
    console.error("Creating a Dwolla Customer Failed - Full Error:", {
      message: err?.message,
      response: err?.response,
      body: err?.response?.body,
      status: err?.response?.status,
      error: err
    });
    
    // Parse Dwolla validation errors
    if (err?.response?.body) {
      const errorBody = err.response.body;
      
      // Check if it's a validation error with embedded errors
      if (errorBody._embedded?.errors && Array.isArray(errorBody._embedded.errors)) {
        const validationErrors = errorBody._embedded.errors.map((e: any) => {
          const field = e.path?.replace('/', '') || 'field';
          return `${field}: ${e.message}`;
        }).join(', ');
        
        throw new Error(`Validation error: ${validationErrors}`);
      }
      
      // Fallback to general error message
      const errorMessage = errorBody?.message || JSON.stringify(errorBody);
      throw new Error(`Dwolla customer creation failed: ${errorMessage}`);
    }
    
    // Try to parse error message if it's a JSON string
    if (err?.message) {
      try {
        const parsedError = JSON.parse(err.message);
        if (parsedError._embedded?.errors) {
          const validationErrors = parsedError._embedded.errors.map((e: any) => {
            const field = e.path?.replace('/', '') || 'field';
            return `${field}: ${e.message}`;
          }).join(', ');
          throw new Error(`Validation error: ${validationErrors}`);
        }
      } catch (parseError) {
        // If parsing fails, use the original message
      }
      throw new Error(`Dwolla customer creation failed: ${err.message}`);
    }
    
    throw new Error("Dwolla customer creation failed. Please check your Dwolla credentials and try again.");
  }
};

export const createTransfer = async ({
  sourceFundingSourceUrl,
  destinationFundingSourceUrl,
  amount,
}: TransferParams) => {
  try {
    const requestBody = {
      _links: {
        source: {
          href: sourceFundingSourceUrl,
        },
        destination: {
          href: destinationFundingSourceUrl,
        },
      },
      amount: {
        currency: "USD",
        value: amount,
      },
    };
    return await dwollaClient
      .post("transfers", requestBody)
      .then((res) => res.headers.get("location"));
  } catch (err) {
    console.error("Transfer fund failed: ", err);
  }
};

export const addFundingSource = async ({
  dwollaCustomerId,
  processorToken,
  bankName,
}: AddFundingSourceParams) => {
  try {
    // create dwolla auth link
    const dwollaAuthLinks = await createOnDemandAuthorization();

    // add funding source to the dwolla customer & get the funding source url
    const fundingSourceOptions = {
      customerId: dwollaCustomerId,
      fundingSourceName: bankName,
      plaidToken: processorToken,
      _links: dwollaAuthLinks,
    };
    return await createFundingSource(fundingSourceOptions);
  } catch (err) {
    console.error("Transfer fund failed: ", err);
  }
};
