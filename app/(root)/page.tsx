import HeaderBox from "@/components/HeaderBox";
import RightSidebar from "@/components/RightSidebar";
import TotalBalanceBox from "@/components/TotalBalanceBox";

const Home = () => {
  const loggedIn = { firstName: "Jeffrey", lastName: 'Fabella', email:'jeffrey.t.fabella@gmail.com' };
  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="greeting"
            title="Welcome"
            user={loggedIn?.firstName || "Guest"}
            subtext="Access and manage your account and transasctions efficiently."
          />

          <TotalBalanceBox
            accounts={[]}
            totalBanks={1}
            totalCurrentBalance={1250.35}
          />
              </header>
              RECENT TRANSACTION
          </div>
          <RightSidebar
              user={loggedIn}
              transactions={[]}
              banks={[{currentBalance: 123.50}, {currentBalance: 2500.00}]}
          />
    </section>
  );
};

export default Home;
