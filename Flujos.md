
## P1. Análisis de Datos Multidimensionales

Usamos el Botón actual Datos y SOM.

Procedimiento Legacy en LabSOM

1. Cargar los datos (verificar si los datos cuentan con los nombres de los indicadores y las etiquetas en los checkboxes “First row as component names” y “first column as data labels”). Dar clic en el botón Load.
2. Normalizar los datos. Dar clic al menú: Normalize/Standardize -> Div By Max - Column
3. Guardar los datos normalizados con el menú File->Save->Matriz. Se recomienda usar el nombre del archivo original y agregar “Normalizado”. Abrir el archivo con un editor de texto y eliminar el último renglón vacío.
4. Una vez establecido el tamaño de la red neuronal en Height y Width dar clic el botón Init Net.
5. Entrenar la red la red neuronal con el botón Train
6. Explorar los mapas: Umatrix y mapas de componentes en las pestañas Maps y Components
7. En la pestaña de los mapas de componentes usar el menú contextual del contenedor para: 1. desnormalizar y 2. cambiar la barra cromática con el menú contextual, primero weight range y después data range.
8. En la pestaña Clustering dar clic en el botón Run Clustering. En la ventana “Aglomera's clustering evaluation results” determinar si hay acuerdo entre las diferentes métricas de evaluación. Escoger el número de clusters que más se repite (si no se trata de los clusterings triviales)
9. Apoyarse en los mapas de componentes y la umatrix para confirmar el númerovde clusters. Puede aumentar o disminuir el número de clusters si hay contradicciones con lo que se observa.
10. Mostrar los contornos de los clusters con el menú View->Show Clusters Contours.
11. Mapear las etiquetas usando el menú Tools->Map data as labels. Si son muchos datos, conviene escoger un subconjunto del archivo que se exportó con la etique "Normalizado" y mapearlo con el menú: File -> Import -> Labels.

    Estructura de los datos:

    Name,% Documents in Q1 Journals,% Documents in Top 1%,% Documents in Top 10%,Category Normalized Citation Impact,Average Percentile,% Industry Collaborations,% International Collaborations
    USA,59.78342455017955,1.7525407950698964,13.615741229153075,1.353454576755017,57.41357822408275,2.6815152579992403,18.65842863179201
    UNITED KINGDOM,56.292766146828114,1.6368550290945705,13.053736922595597,1.3090200012420592,57.01166429784812,2.7034283063088678,31.214826898723235
    CHINA MAINLAND,40.688641375021206,1.0411150827068945,9.213428936246592,0.8818957250679459,61.54405478063889,1.39644704759557,20.217932041872295
    ENGLAND,56.697938468145196,1.7015350508116265,13.337781531013624,1.335714489597907,56.779832643514574,2.9483893886620183,31.503730296029712
    GERMANY (FED REP GER),51.60424367812489,1.4355097985747876,11.938191572563719,1.1580048264031824,56.565288362334954,3.272529748227337,36.24812068786571
    JAPAN,44.68379833945001,0.8179962246801533,8.319705704770481,0.8636836507539861,59.43367754035518,3.3864015859543817,18.418347783645984
    FRANCE,52.89490776562029,1.385599883607907,11.650391894652774,1.1424807799431027,55.97546170700152,3.504609250694948,38.33815462813345
    CANADA,55.10233095533965,1.5856967009558405,12.69017325478205,1.2695079777714673,55.527359578090035,2.163226707323609,33.89053768187068
    ITALY,52.285243242733536,1.3460763306956318,11.575428058233495,1.14755911380909,55.992459599425175,2.418583318937605,35.64937866017697
    AUSTRALIA,50.82028307017933,1.6480401786728816,12.976572541038454,1.276054755498938,54.245296703351535,1.5377584078014097,36.0562683224293

    # P2. Análisis de Datos Multidimensionales Temporales (PathSOM)

    Procedimiento P1 más los siguientes pasos extras

    Suavizado de las series temporales

    Splines para dibujar curvas

    Estructora de los datos:

    Name;Web of Science Documents;SNI;ISP;Category Normalized Citation Impact;% Documents in Top 1%;% Documents in Top 10%;% International Documents;% Documents in Q1 Journals;% Industry Collaborations
    2011_UNAM;4580;3583;1.278258443;0.721029607;0.76;6.55;37.53;38.62;0.79
    2012_UNAM;4804;3619;1.327438519;0.797186553;0.69;7.16;37.82;39.21;0.81
    2013_UNAM;5024;3774;1.331213567;0.735781967;0.78;6.39;38.04;38.92;0.82
    2014_UNAM;5354;3954;1.354071826;0.779967949;0.78;6.82;38.89;39.08;1.08
    2015_UNAM;5683;4191;1.356000954;0.771561464;0.84;6.35;39.5;39.45;1
    2016_UNAM;6166;4313;1.429631347;0.867017515;0.96;7.27;42.2;38.87;0.92
    2017_UNAM;6540;4568;1.431698774;0.806403028;0.98;6.9;41.59;38.61;0.95
    2018_UNAM;6774;4737;1.430018999;0.746816711;0.59;6.23;44.1;35.97;0.96
    2019_UNAM;7411;4812;1.540108063;0.823781136;1;6.34;42.06;35.13;0.86
    2020_UNAM;7836;5005;1.565634366;0.990291679;0.93;6.62;44.53;36.99;0.68
    2021_UNAM;8186;5005;1.635564436;0.924359846;1.06;7.2;44.88;39.93;0.99
    2022_UNAM;7526;5763;1.305917057;0.900835504;0.98;6.74;43.13;37.36;1.34
    2023_UNAM;7441;4796;1.551501251;0.889082408;1.09;6.42;43.77;40.98;1.37
    2024_UNAM;7736;5805;1.332644272;1.047484863;0.85;5.78;44.18;37.53;1.11
    2025_UNAM;7891;5785;1.364044944;0.954194196;0.82;6.08;43.47;37.53;1.09
    2011_IPNM;2146;788;2.723350254;0.788312628;0.93;7.32;37.56;40.51;0.84
    2012_IPNM;2500;831;3.008423586;0.79975936;0.8;7.24;35.92;40.05;1.08
    2013_IPNM;2697;900;2.996666667;0.821706489;0.89;7.86;34.04;39.54;1.33
    2014_IPNM;2874;1032;2.784883721;0.816643772;1.22;7.97;33.23;39.67;1.29
    2015_IPNM;3154;1111;2.838883888;0.900125016;0.92;7.39;35.16;34.34;1.11
    2016_IPNM;3297;1137;2.899736148;0.772849742;0.55;6.1;36;40.38;1.27
    2017_IPNM;3329;1196;2.783444816;0.769337909;0.87;6.64;35.99;34.65;1.11
    2018_IPNM;3480;1212;2.871287129;0.733755489;0.55;5.95;36.52;32.48;1.58
    2019_IPNM;3659;1257;2.910898966;0.738376141;0.71;6.18;38.04;34.78;1.5
    2020_IPNM;3640;1301;2.797847809;0.753326346;0.77;7.09;37.58;35.7;1.37
    2021_IPNM;3523;1301;2.707916987;0.690342549;0.6;5.9;36.82;35.72;1.45
    2022_IPNM;3271;1407;2.324804549;0.642393733;0.46;5.01;35.19;36.66;0.86
    2023_IPNM;3109;1326;2.344645551;0.841276713;0.64;5.31;35.96;41.83;1.13
    2024_IPNM;3329;1601;2.079325422;0.865636107;0.42;4.42;35.09;37.95;1.02
    2025_IPNM;3518;1576;2.232233503;0.701736697;0.65;4.83;33.26;37.95;1.08

    # P3 Procedimiento Bibliométrico. Replicar funcionalidad de bibliometrix y pybibx.

    Se cargan datos desde archivos con metadatos de articulos cientificos (procedentes de pubmed o de web os science, scopus, openalex, lens). Se extraen campos para generar y visualizar redes bibliométricas. Con las matrices de adyacencia o coocurrencia se crean mapas con el SOM siguiendo el procedimiento P1.
