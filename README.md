jspm artifactory github plugin
======
This is plugin for JSPM, that retrieves Github packages via Artifactory.
It solves the problem that Artifactory can cache Github repositories but does not expose Github's API.


This software is AS IS I have to


##Installation
```
npm install jspm-artifactory-github
```

##How to configure
```
jspm config registries.github.handler jspm-artifactory-github //overrides the original github plugin 
jspm config registries.github.remote <artifactory-github-api-uri>
```
