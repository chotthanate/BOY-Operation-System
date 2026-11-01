(() => {
  "use strict";
  async function signIn(client, config, pin) {
    if (!/^\d{6}$/.test(pin)) return {data:{session:null},error:{status:400,message:"รหัสต้องมี 6 หลัก"}};
    const accounts = [...new Set([config.ownerLoginEmail,config.staffLoginEmail].filter(Boolean))];
    let result = {data:{session:null},error:{status:400,message:"Invalid login credentials"}};
    for (const email of accounts) {
      result = await client.auth.signInWithPassword({email,password:pin});
      if (!result.error) return result;
      if (![400,401].includes(result.error.status) || !/invalid.*credentials/i.test(result.error.message||"")) break;
    }
    return result;
  }
  globalThis.BOY_PIN_AUTH = {signIn};
})();
