import HeaderBox from "@/components/HeaderBox";
import RecentTransactions from "@/components/RecentTransactions";
import RightSidebar from "@/components/RightSidebar";
import TotalBalanceBox from "@/components/TotalBalanceBox";
import { getAccount, getAccounts } from "@/lib/actions/bank.actions";
import { getLoggedInUser } from "@/lib/actions/user.actions";

export const dynamic = "force-dynamic";

const Home = async ({ searchParams }: SearchParamProps) => {
  const resolvedSearchParams = await searchParams;
  const id = resolvedSearchParams.id;
  const page = resolvedSearchParams.page;
  const currentPage = Number(page as string) || 1;
  const loggedIn = await getLoggedInUser();
  const accounts = await getAccounts({
    userId: loggedIn.$id,
  });

  if (!accounts) return;

  const accountsData = accounts?.data;
  const appwriteItemId = (id as string) || accountsData[0]?.appwriteItemId;

  if (!appwriteItemId) {
    return (
      <section className="home">
        <div className="home-content">
          <header className="home-header">
            <HeaderBox
              type="greeting"
              title="Welcome"
              user={loggedIn?.firstName || "Guest"}
              subtext="Access and manage your account and transactions efficiently."
            />
            <TotalBalanceBox
              accounts={accountsData}
              totalBanks={accounts?.totalBanks}
              totalCurrentBalance={accounts?.totalCurrentBalance}
            />
          </header>
          <div className="flex-center mt-4">
            <p className="text-16 text-gray-500">No account selected. Please connect a bank account.</p>
          </div>
        </div>
      </section>
    );
  }

  const account = await getAccount({ appwriteItemId });
  
  if (!account) {
    return (
      <section className="home">
        <div className="home-content">
          <header className="home-header">
            <HeaderBox
              type="greeting"
              title="Welcome"
              user={loggedIn?.firstName || "Guest"}
              subtext="Access and manage your account and transactions efficiently."
            />
            <TotalBalanceBox
              accounts={accountsData}
              totalBanks={accounts?.totalBanks}
              totalCurrentBalance={accounts?.totalCurrentBalance}
            />
          </header>
          <div className="flex-center mt-4">
            <p className="text-16 text-gray-500">No account found. Please connect a bank account.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="greeting"
            title="Welcome"
            user={loggedIn?.firstName || "Guest"}
            subtext="Access and manage your account and transactions efficiently."
          />

          <TotalBalanceBox
            accounts={accountsData}
            totalBanks={accounts?.totalBanks}
            totalCurrentBalance={accounts?.totalCurrentBalance}
          />
        </header>

        <RecentTransactions
          accounts={accountsData}
          transactions={account?.transactions}
          appwriteItemId={appwriteItemId}
          page={currentPage}
        />
      </div>

      <RightSidebar
        user={loggedIn}
        transactions={account?.transactions}
        banks={accountsData?.slice(0, 2)}
      />
    </section>
  );
};

export default Home;
