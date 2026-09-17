<?php
require_once '/var/www/html/src/init.php';
$conf = initialize_conf();
if (!$conf->setting('das_poc_seeded')) {
    $chair = Contact::make_keyed($conf, [
        'email' => 'chair@example.test',
        'firstName' => 'Demo',
        'lastName' => 'Chair'
    ]);
    if (!$chair->store()) {
        throw new RuntimeException('Could not create demo chair');
    }
    $chair->save_roles(Contact::ROLE_PC | Contact::ROLE_ADMIN | Contact::ROLE_CHAIR, $conf->root_user());
    $chair->change_password('DAS-demo-local-2026!');
    $conf->save_setting('setupPhase', null);
    $conf->save_setting('sub_open', 1);
    $conf->save_setting('sub_reg', time() + 365 * 86400);
    $conf->save_setting('sub_update', time() + 365 * 86400);
    $conf->save_setting('sub_sub', time() + 365 * 86400);
    $conf->save_setting('das_poc_seeded', 1);
    fwrite(STDERR, "Demo chair created: chair@example.test / DAS-demo-local-2026!\n");
}
