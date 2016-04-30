jspm artifactory github plugin
======
This is a plugin for JSPM, that retrieves Github packages via Artifactory.
It solves the problem that Artifactory can cache Github repositories but does not expose Github's API.


THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


##Installation
```
npm install jspm-artifactory-github
```

##How to configure
```
jspm config registries.github.handler jspm-artifactory-github //overrides the original github plugin 
jspm config registries.github.remote <artifactory-github-api-uri>
```
