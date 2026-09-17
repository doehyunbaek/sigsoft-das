<?php
// Disposable localhost demo only. Do not use these credentials in production.
$Opt["dbHost"] = getenv("DB_HOST") ?: "db";
$Opt["dbName"] = "hotcrp";
$Opt["dbUser"] = "hotcrp";
$Opt["dbPassword"] = "local-test-only";
$Opt["shortName"] = "DAS PoC";
$Opt["longName"] = "Data-Availability Statement checker test";
$Opt["sendEmail"] = false;
$Opt["dasChecker"] = true;
$Opt["scripts"][] = "scripts/das-checker/loader.js";
