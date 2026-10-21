/**
 * MIGZ_TEST_MODE=1: everything is built for real in Meta (campaign, ad set, uploads, ads) but held
 * paused at every level, so you can preview the finished ads in Ads Manager and nothing can deliver or
 * spend. Remove the flag and the next review switches on the campaign, its ad sets and the held ads.
 */
export const isTestMode = () => process.env.MIGZ_TEST_MODE === "1";
