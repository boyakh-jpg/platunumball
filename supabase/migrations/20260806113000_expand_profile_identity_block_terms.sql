begin;

create table if not exists public.profile_identity_block_sources (
  source_key text primary key,
  display_name text not null,
  source_url text not null,
  license text not null,
  revision text not null,
  updated_at timestamptz not null default now()
);

alter table public.profile_identity_block_sources enable row level security;
revoke all on public.profile_identity_block_sources from public, anon, authenticated;
grant select, insert, update, delete on public.profile_identity_block_sources to service_role;

insert into public.profile_identity_block_sources (
  source_key,
  display_name,
  source_url,
  license,
  revision
)
values
  (
    'boxtier-curated',
    'BOXTIER 운영 정책',
    'https://boxtier.kr',
    'Proprietary',
    '2026-08-06'
  ),
  (
    'tetrapod-ko',
    'Tetrapod Korean bad-words dictionary',
    'https://github.com/hmmhmmhm/tetrapod',
    'MIT',
    'c75aa2fd912111da448f404302663a2f76bdf7bd'
  ),
  (
    'dsojevic-en',
    'dsojevic profanity-list English dictionary',
    'https://github.com/dsojevic/profanity-list',
    'MIT',
    'c27924319aa9bd6f917e3782b4f4b6604a50b652'
  )
on conflict (source_key) do update set
  display_name = excluded.display_name,
  source_url = excluded.source_url,
  license = excluded.license,
  revision = excluded.revision,
  updated_at = clock_timestamp();

alter table public.profile_identity_block_terms
  add column if not exists source_key text not null default 'boxtier-curated',
  add column if not exists source_severity smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profile_identity_block_terms'::regclass
      and conname = 'profile_identity_block_terms_source_key_fkey'
  ) then
    alter table public.profile_identity_block_terms
      add constraint profile_identity_block_terms_source_key_fkey
      foreign key (source_key)
      references public.profile_identity_block_sources(source_key);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profile_identity_block_terms'::regclass
      and conname = 'profile_identity_block_terms_source_severity_check'
  ) then
    alter table public.profile_identity_block_terms
      add constraint profile_identity_block_terms_source_severity_check
      check (source_severity is null or source_severity between 1 and 4);
  end if;
end;
$$;

with source_terms as (
  select distinct public.rankball_profile_identity_term_key(value) as term
  from jsonb_array_elements_text(
    $terms$["c발","g랄","g스팟","si발","x끼","z랄","간나","갈보","강간","개","개가튼넘","개같네","개같은","개구라","개년","개놈","개뇬","개대중","개독","개돼중","개랄","개뻥","개뿔","개새","개새기","개새끼","개새키","개색기","개색끼","개색키","개색히","개섀끼","개세","개세끼","개세이","개소리","개쇳기","개수작","개쉐","개쉐리","개쉐이","개쉑","개쉽","개스끼","개시키","개십새기","개십새끼","개쌔끼","개쐑","개쑈","개씹","개아들","개자슥","개자식","개접","개좆","개좌식","개처럼","개허접","갱뱅","걔새","걔수작","걔시끼","걔시키","걔썌","거시기","걸레","게색기","게색끼","고추","고츄","곧츄","곧휴","곶츄","곶휴","광뇬","구녕","구라","구멍","그년","그새끼","ᄁᄌ","까","까러","깔어","꺄","꺼져","껃여","껃져","껒여","꼬봉","꼬우냐","꼬추","꼬츄","꼳츄","꼳휴","꼴린다","꼽냐","꼽다","꼽사리","꽂추","꽂츄","끼","냄비","녜미","놈현","뇬","눈까러","눈깔","눈깔어","뉘뮈","뉘미럴","느금","느금마","늬미","늬미럴","니귀미","니기미","니미","니미랄","니미럴","니미씹","니아배","니아베","니아비","니어매","니어메","니어미","니엄마","닚","닝기리","닝기미","닥쳐","닥쵸","닭쳐","닶","대가리","대갈","뎡신","도라이","돈놈","돌아이","돌은놈","되질래","뒈져","뒈져라","뒈진","뒈진다","뒈질","뒤질래","등신","디져라","디진다","디질래","딩시","따먹","따식","딸딸이","때놈","또라이","똘기","똘아이","똘추","뙈놈","뙤놈","뙨넘","뙨놈","뚜쟁","띠바","띠발","띠불","띠팔","랄지","로리","ᄆᄎ","메친넘","메친놈","미췬","미친","미친넘","미친년","미친놈","미친새끼","미친스까이","미틴","미틴넘","미틴년","미틴놈","ᄇᄉ","바랄년","발","뱅마","뱅신","벌","벼엉신","벼으신","병쉰","병신","병자","보지","부랄","부럴","불","불알","불할","붕가","붙어먹","뷰웅","븅","븅신","빌어먹","빌어먹을","빙시","빙신","빠가","빠구리","빠굴","빠큐","빡유","빨","빸유","뻐큐","뻑","뻑큐","뻨","뽀지","뽀찌","뽁큐","삐리리","ᄡ","사까시","사까아시","사까아시이","삾","삿갓이","상넘이","상놈을","상놈의","상놈이","새","새x","새갸","새꺄","새끼","새새끼","새애액스","새에액스","새키","색끼","색스","생쑈","샥스","샫업","샷업","성교","성노예","성폭행","세갸","세꺄","세끼","세애액스","세에엑스","섹스","섻","쇅끼","쇡끼","쇼하네","쉐","쉐기","쉐끼","쉐리","쉐에기","쉐키","쉑","쉣","쉨","쉬박","쉬발","쉬밸","쉬벌","쉬빡","쉬뻘","쉬탱","쉬팍","쉬펄","쉽세","쉽알","슈바","슈발","스패킹","스팽","시bal","시궁창","시끼","시댕","시뎅","시랄","시바","시발","시방","시밬","시벌","시부랄","시부럴","시부리","시불","시브랄","시이발","시팍","시팔","시펄","심발","심탱","십8","십라","십새","십새끼","십세","십쉐","십쉐이","십스키","십쌔","십알","십창","십탱","십할","싶알","ᄊ앙","싸가지","싹아지","쌉년","쌍넘","쌍년","쌍놈","쌍뇬","쌔끼","쌕","쌩쑈","쌰럽","쌴년","썅","썅년","썅놈","썡쇼","써벌","썩을년","썩을놈","쎄꺄","쎄엑","쎄엑스","쎅쓰","쎡","쎽","쎾","쎾스","쏐","쏐쓰","쑤시자","쑤우시자","쒝","쒞","쒸벌","쒸뻘","쒸팔","쒸펄","쓰바","쓰박","쓰발","쓰벌","쓰파","쓰팔","씁새","씁얼","씌파","씨","씨8","씨가랭","씨끼","씨댕","씨뎅","씨바","씨바랄","씨박","씨발","씨방","씨방새","씨방세","씨밸","씨뱅","씨벌","씨벨","씨봉","씨봉알","씨부랄","씨부럴","씨부렁","씨부리","씨불","씨붕","씨브랄","씨빠","씨빨","씨뽀랄","씨앙","씨엑스","씨파","씨팍","씨팔","씨펄","씨퐁","씨풍","씸년","씸뇬","씸새끼","씹같","씹년","씹뇬","씹덕","씹덕후","씹물","씹새","씹새기","씹새끼","씹새리","씹세","씹쉐","씹스키","씹쌔","씹이","씹질","씹창","씹탱","씹퇭","씹팔","씹할","씹헐","아가리","아갈","아갈빡","아갈이","아갈통","아구창","아구통","아굴","아날","아닥","아헤가오","애널","애무","애미","애비","앰창","얌마","양넘","양년","양놈","엄창","에미","에비","엠병","엠창","여물통","염병","염창","엿같","옘병","옘빙","오라질","오라질년","오랄","오럴","오입","왜년","왜놈","욤병","운지","유두","유방","육갑","은년","을년","이년","이새끼","이새키","이스끼","이스키","임마","입싸","ᄌᄅ","자슥","자지","잡것","잡넘","잡년","잡놈","쟈지","저년","저새끼","접년","정액","젖꼭지","젖꼮찌","젖밥","조까","조까치","조낸","조또","조랭","조빠","조쟁이","조지냐","조진다","조질래","조찐","존나","존나게","존니","존만","존만한","졸라","졸래","좀물","좁년","좁밥","좃","좃까","좃또","좃만","좃밥","좃이","좃찐","좆","좆같","좆까","좆나","좆또","좆만","좆밥","좆이","좆찐","좇같","좇이","좋같은","좋만","주글","주글래","주데이","주뎅","주뎅이","주둥아리","주둥이","주접","주접떨","죽고잡","죽을래","죽통","쥐랄","쥐롤","쥐뢀","쥬디","지ral","지x","지랄","지럴","지롤","지미랄","지스팟","질싸","짜식","짜아식","짜지","짜찌","쪼다","쫍빱","찌랄","창남","창녀","창년","창놈","챵년","凸","쳐닥","촌년","촌놈","캐년","캐놈","캐스끼","캐스키","캐시키","크리토리스","클리토리스","탱구","파","팔럼","퍽큐","펄","핪","헐보","호구","호로","후라덜","후라들","후래자식","후레","후레자식","후뢰","후장","ᅩ","ᅵ발","ᅵ벌","ᅵ불","ᅵ빨","ᅵ펄"]$terms$::jsonb
  ) imported(value)
)
insert into public.profile_identity_block_terms (
  term,
  category,
  match_mode,
  owner_allowed,
  active,
  source_key
)
select
  term,
  'profanity',
  'exact',
  false,
  true,
  'tetrapod-ko'
from source_terms
where term <> ''
on conflict (term) do nothing;

with source_groups (category, source_severity, terms) as (
  values
    ('profanity', 3, $terms$["acrotomophile","acrotomophilia","alabamahotpocket","alabamatunamelt","alaskanpipeline","algophile","algophilia","anilingus","apotemnophile","apotemnophilia","arsehole","asshole","autoerotic","babeland","babybatter","babygravy","babyjuice","ballbatter","ballcuzi","ballgag","ballgravy","ballkicking","balllicking","ballsack","ballsucking","bangbros","bangbus","bareback","bastard","bastinado","bdsm","beastiality","beavercleaver","beaverlips","beestiality","bellend","bellesa","bestiality","bigboobs","bigbreasts","bigcock","bigknockers","bigtits","birdlock","bitch","bitches","blackcock","blowjob","blowyourload","blumpkin","boner","bootycall","bostongeorge","brownshower","brownshowers","bukkake","bulletvibe","bulletvibrator","cameltoe","canadianporchswing","chocolaterosebud","chocolaterosebuds","cholerophile","cholerophilia","cialis","circlejerk","claustrophile","claustrophilia","clevelandaccordion","clevelandhotwaffle","clevelandsteamer","clit","clitoris","cloverclamp","cloverclamps","clunge","coimetrophile","coimetrophilia","collared","collaring","coprolagnia","coprophile","coprophilia","cornhole","creampie","cum","cumming","cumshot","cumshots","cunnilingus","ddlg","deepthroat","dendrophile","dendrophilia","dildo","dildos","dipsea","dirtypillows","dirtysanchez","dishabiliophile","dishabiliophilia","doggiestyle","doggystyle","dogstyle","dolcett","domination","dominatrix","domme","dommes","donkeypunch","doublepenetration","dpaction","dryhump","dutchrudder","dystychiphile","dystychiphilia","edgeplay","ejaculate","ejaculated","ejaculating","ejaculation","electroplay","emetophile","emetophilia","eskimotrebuchet","felch","felching","fellating","fellatio","femalesquirting","figging","fingerbang","fingerbanging","fingered","fingering","fisted","fisting","footjob","frenchrudder","frolicme","frottage","frotting","gangbang","gaysex","genitorture","gerontophile","gerontophilia","giantcock","girlontop","gokkun","gokun","goldenshower","goldenshowers","grope","groupsex","gspot","handjob","hickoryswitch","hippophile","hippophilia","homoerotic","horny","hotcarl","hotrichard","hugecock","humping","impactplay","intercourse","jellydonut","jerkmate","jizz","juggs","kennebunkportsurprise","kentuckyklondike","kentuckytractorpuller","kinbaku","knobbing","kynophile","kynophilia","leatherrestraint","leatherstraightjacket","leningradsteamer","literotica","lovemaking","malesquirting","massivecock","mdlb","menageatrois","menagesatrois","menophile","menophilia","mexicanpancake","milwaukeeblizzard","missionaryposition","mississippibirdbath","muffdiver","muffdiving","mvtube","necrophile","necrophilia","nigerianhurricane","nimpho","nimphomania","nimphomaniac","nippleclamp","nippleclamps","nude","nudity","nutten","nympho","nymphomania","nymphomaniac","octopussy","omorashi","onlyfans","orgasm","orgasmic","orgasms","paedophile","paedophilia","painslut","panamanianpettingzoo","panties","parthenophile","parthenophilia","pedophile","pedophilia","pegging","phagophile","phagophilia","pissing","playboy","pleasurechest","pnigerophile","pnigerophilia","pnigophile","pnigophilia","poinephile","poinephilia","ponyboy","ponygirl","ponyplay","poon","poontang","poopchute","pornhub","princealbertpiercing","proctophile","proctophilia","punani","punany","pussy","queaf","queef","quim","raghead","ragheads","ragingboner","ramenyarmulke","reversecowgirl","rhabdophile","rhabdophilia","rhypophile","rhypophilia","rimjob","rimming","rustytrombone","santorum","scatophile","scatophilia","schlong","scissoring","seplophile","seplophilia","sex","shavedbeaver","shavedpussy","shibari","shithead","shlong","shrimping","skeet","skittleharvest","skittlesharvest","snowballing","sodomise","sodomist","sodomize","sodomy","spicygringo","splooge","sploogemoose","spooge","spunk","strapon","taphephile","taphephilia","teabagged","teabagging","thanatophile","thanatophilia","threesome","throating","throbbingboner","throbbingcock","thumbzilla","topless","traumatophile","traumatophilia","tribadism","tribbing","twat","urethraplay","urophile","urophilia","viagra","vibrator","violetwand","vorarephile","vorarephilia","voyeurweb","waxplay","wetdream","whore","wiitwd","wolfbagging","worldsex","wrappingmen","wrinkledstarfish","xhamster","xnxx","xtube","xvideos","xyrophile","xyrophilia","yellowshower","yellowshowers","zoophile","zoophilia"]$terms$::jsonb),
    ('profanity', 4, $terms$["1m1j","1man1jar","2g1c","2girls1cup","barelylegal","bluewaffle","clusterfuck","cunt","cunts","daterape","fuck","fucken","fucker","fuckers","fuckhead","fuckheads","fuckin","fucking","fucks","fucktard","fucktards","fuckwad","fuckwads","fuckwhit","fuckwit","fuckwits","goatcx","goatse","goregasm","incest","jailbait","kunt","kunts","lemonparty","meatspin","mrhands","nambla","onecuptwogirls","onejaroneman","onemanonejar","paedobear","pedobear","pisspig","rape","raping","rapist","shota","strappado","tubgirl","twogirlsonecup","zippocat"]$terms$::jsonb),
    ('hate', 3, $terms$["beaner","beaners","buddhahead","cameljockey","cameljockies","cheeseeatingsurrendermonkey","chink","chinks","chinky","coon","coons","currymuncher","darkey","darkie","darkies","darky","dooncoon","dunecoon","gook","gookeye","gookie","gooks","gooky","jigaboo","jiggerboo","kike","nigga","niggs","nignog","paki","petrolsniffer","pikey","pikeys","slanteye","spearchucker","spic","spick","spicks","spics","swampguinea","towelhead","wetback","whitepower","zipperhead"]$terms$::jsonb),
    ('hate', 4, $terms$["nigger","sandnigger","timbernigger"]$terms$::jsonb)
),
source_terms as (
  select
    group_row.category,
    group_row.source_severity,
    public.rankball_profile_identity_term_key(imported.value) as term
  from source_groups group_row
  cross join lateral jsonb_array_elements_text(group_row.terms) imported(value)
)
insert into public.profile_identity_block_terms (
  term,
  category,
  match_mode,
  owner_allowed,
  active,
  source_key,
  source_severity
)
select distinct
  term,
  category,
  'exact',
  false,
  true,
  'dsojevic-en',
  source_severity
from source_terms
where term <> ''
on conflict (term) do nothing;

select pg_notify('pgrst', 'reload schema');

commit;
